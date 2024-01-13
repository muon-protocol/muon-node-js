import CallablePlugin from './base/callable-plugin.js'
import {getTimestamp} from '../../utils/helpers.js'
import { remoteApp } from './base/app-decorators.js'
import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"
import Web3 from 'web3'
import { remoteMethod } from '../../network/plugins/base/app-decorators.js'
import { MuonNodeInfo, PartyInfo } from '../../common/types.js'
import NodeManagerPlugin from "./node-manager.js";
import AppManager from './app-manager.js'
import {Mutex} from "../../common/mutex.js";
import * as PromiseLib from "../../common/promise-libs.js"
import { muonSha3 } from '../../utils/sha3.js'
import * as crypto from "../../utils/crypto.js";
import _ from 'lodash'
import { MapOf } from '../../common/mpc/types.js'
import SystemPlugin from './system.js'

export type MemWriteType = 'local' | "global"

export type MemWrite = {
  type: MemWriteType,
  owner: string,
  timestamp: number,
  ttl: number,
  key: string,
  value: any,
}

export type MemWriteOptions = {
  getset?:boolean,
  preventRewrite?: boolean
}

export type MemReadOption = {
  distinct?: boolean,
  multi?: boolean
}

/** The time that memory write needs to be confirmed */
const WRITE_CONFIRM_TTL = 5;

const RemoteMethods = {
  PrepareGlobalWrite: "prepare-global-write",
  FinalizeGlobalWrite: "finalize-global-write",
  GlobalRead: "global-read",
}

@remoteApp
class MemoryPlugin extends CallablePlugin {
  /** Fix the conflict bug, when more than one node is running on the server. */
  private readonly keyPrefix = Web3.utils.sha3(`memory-plugin-${process.env.SIGN_WALLET_ADDRESS!}`)

  private redisClient: RedisClient;
  private redisSet: (...args)=>Promise<any>;
  private redisGet: (key: string)=>Promise<any>;
  private redisGetset: (...args)=>Promise<any>;
  private redisExpire: (...args)=>Promise<any>;
  private mutex:Mutex;

  constructor(muon, configs) {
    super(muon, configs);

    const redisClient = createClient(redisConfig);

    redisClient.on("error", (error) => {
      console.error(`MemoryPlugin redis client error`, error);
    });

    this.redisSet = promisify(redisClient.set).bind(redisClient)
    this.redisGet = promisify(redisClient.get).bind(redisClient)
    this.redisGetset = promisify(redisClient.getset).bind(redisClient)
    this.redisExpire = promisify(redisClient.expire).bind(redisClient)

    this.redisClient = redisClient
  }

  async onInit() {
    this.mutex = new Mutex();
  }

  private get nodeManager(): NodeManagerPlugin{
    return this.muon.getPlugin('node-manager');
  }

  private get appManager(): AppManager{
    return this.muon.getPlugin("app-manager");
  }

  private get system(): SystemPlugin{
    return this.muon.getPlugin("system");
  }

  async writeLocalMem(appId: string, key: string, value: string, ttl: number=0, options:MemWriteOptions={}) {
    let memWrite: MemWrite = {
      type: "local",
      owner: process.env.SIGN_WALLET_ADDRESS!,
      timestamp: getTimestamp(),
      ttl,
      key,
      value,
    }
    if(options.preventRewrite) {
      let lock = await this.mutex.lock(`write-local-mem-${this.hashMemWrite(appId, memWrite)}`, 1000)
      try {
        let value:string|null = await this.readLocalMem(appId, memWrite.key);
        if(value)
          throw `Local memory is already written.`
        return await this.storeMemWrite(appId, memWrite, options);
      }
      finally {
        await lock.release();
      }
    }
    else {
      return await this.storeMemWrite(appId, memWrite, options);
    }
  }

  async readMem(appId: string, key: string, type:MemWriteType): Promise<MemWrite|null> {
    return this.redisGet(this.getCacheKey(appId, key))
      .then(strData => {
        try {
          const data:MemWrite = JSON.parse(strData)
          if(data.type !== type)
            return null
          return data;
        }
        catch(e) {
          return null;
        }
      })
  }

  getCacheKey(appId: string, key: string): string {
    return `${this.keyPrefix}-${appId}-${key}`
  }

  async readLocalMem(appId: string, key: string): Promise<string|null> {
    const memWrire = await this.readMem(appId, key, "local")
    return memWrire ? memWrire.value : null;
  }

  private async storeMemWrite(appId: string, memWrite: MemWrite, options:MemWriteOptions={}){
    let {timestamp, key, value, ttl} = memWrite;
    if(!key)
      throw `MemoryPlugin.storeMemWrite ERROR: key not defined in MemWrite.`
    if(typeof value !== "string")
      throw `Only string data can be saved.`
    if(ttl && ttl>0) {
      let expireAt = (timestamp + ttl) * 1000;
      ttl -= (getTimestamp() - timestamp)
      const dataToSave = {...memWrite, expireAt};
      if(options.getset){
        const result = await this.redisGetset(this.getCacheKey(appId, key), JSON.stringify(dataToSave))
        await this.redisExpire(this.getCacheKey(appId, key), ttl)
        return result;
      }
      else {
        await this.redisSet(this.getCacheKey(appId, key), JSON.stringify(dataToSave), 'EX', ttl)
      }
    }
    else {
      if(options.getset) {
        return await this.redisGetset(this.getCacheKey(appId, key), JSON.stringify(memWrite));
      }
      else {
        await this.redisSet(this.getCacheKey(appId, key), JSON.stringify(memWrite));
      }
    }
  }

  private hashMemWrite(appId: string, memWrite: MemWrite): string {
    const {key, value, owner, ttl, timestamp, type} = memWrite;
    return muonSha3(
      {t: "string", v: key},
      {t: "uint256", v: appId},
      {t: "string", v: value},
      {t: "address", v: owner},
      {t: "string", v: type},
      {t: "uint64", v: ttl},
      {t: "uint64", v: timestamp},
    )
  }

  async writeGlobalMem(appId: string, key: string, value: string, ttl: number=0, options:MemWriteOptions={}) {
    if(typeof value !== "string")
      throw `Only string data can be saved.`

    let memWrite: MemWrite = {
      type: "global",
      owner: process.env.SIGN_WALLET_ADDRESS!,
      timestamp: getTimestamp(),
      ttl,
      key,
      value,
    }
    const deployers:MuonNodeInfo[] = this.nodeManager.filterNodes({isDeployer: true})
    let responses:string[] = await Promise.all(
      deployers.map(({peerId, id}) => {
        return (
          id === this.currentNodeInfo?.id
          ?
          this.__prepareGlobalWrite({appId, memWrite}, this.currentNodeInfo)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.PrepareGlobalWrite,
            {appId, memWrite},
            {timeout: 5000},
          )
        )
        .catch(e => {
          return e.onRemoteSide ? "error" : "offline";
        })
      })
    )

    const numOnlines = responses.filter(r => r !== "offline").length;
    const numRequired = Math.max(
      this.netConfigs.tss.threshold,
      Math.round(numOnlines*2/3)
    );
    const signs = responses.filter(r => (r != "error" && r != "offline"));
    if(signs.length < numRequired)
      throw `Memory write not confirmed.`;

    const finalizeRes: string[] = await Promise.all(
      deployers.map(({peerId, id}) => {
        return (
          id === this.currentNodeInfo?.id
          ?
          this.__finalizeGlobalWrite({appId, memWrite, signs}, this.currentNodeInfo)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.FinalizeGlobalWrite,
            {appId, memWrite, signs},
            {timeout: 5000},
          )
        )
        .then(() => "ok")
        .catch(e => {
          return e.onRemoteSide ? e.message : "offline"
        })
      })
    )

    if(finalizeRes.filter(r => r === "ok").length < numRequired)
      throw `No enough deployers confirm the memory write`

    return finalizeRes.reduce((obj, r, i) => (obj[deployers[i].id]=r, obj), {});
  }

  async readGlobalMem(appId: string, key: string): Promise<{owner: string, value: string}|null> {
    let results:string[][] = await PromiseLib.resolveN(
      this.netConfigs.tss.threshold,
      this.nodeManager.filterNodes({isDeployer: true}).map(({peerId, id}) => {
        return (
          id === this.currentNodeInfo!.id
          ?
          this.__readGlobal({appId, key}, this.currentNodeInfo!)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.GlobalRead,
            {appId, key},
            {timeout: 5000},
          )
        )
      }),
      true
    )
    let uniqueResults = _.uniq(results.filter(r => !!r).map(r => JSON.stringify(r)));
    if(uniqueResults.length !== 1)
      return null;
    const [owner, value] = JSON.parse(uniqueResults[0]);
    return {owner, value};
  }

  @remoteMethod(RemoteMethods.PrepareGlobalWrite)
  async __prepareGlobalWrite(data: {appId: string, memWrite: MemWrite}, callerInfo: MuonNodeInfo) {
    const {appId, memWrite} = data
    
    if(memWrite.owner !== callerInfo.wallet)
      throw `Memory write owner missmatched.`

    if(memWrite.type !== 'global')
      throw `Memory write type missmatched.`

    let appContexts = this.appManager.getAppAllContext(appId);
    if(!appContexts.find(ctx => ctx.party.partners.includes(callerInfo.id)))
      throw `Only App partners can write to the App's memory`;

    if(!this.currentNodeInfo!.isDeployer)
      throw `Only deployers can store the memory data.`

    const lock = await this.mutex.lock(`mem-write:${this.getCacheKey(appId, memWrite.key)}`);
    try {
      let local:MemWrite|null = await this.readMem(appId, memWrite.key, "global");
      if(local) {
        if(local.owner !== memWrite.owner)
          throw `Memory already writed with other node`;
        if(local.key === memWrite.key && local.value !== memWrite.value)
          throw `Memory already writed with other value`;
      }
      await this.storeMemWrite(appId, {...memWrite, ttl: WRITE_CONFIRM_TTL});

      const hash = this.hashMemWrite(appId, memWrite);
      return crypto.sign(hash)
    }
    finally {
      await lock.release()
    }
  }

  @remoteMethod(RemoteMethods.FinalizeGlobalWrite)
  async __finalizeGlobalWrite(data: {appId: string, memWrite: MemWrite, signs: string[]}, callerInfo: MuonNodeInfo) {
    const {appId, memWrite, signs} = data
    
    if(memWrite.owner !== callerInfo.wallet)
      throw `Memory write owner missmatched.`;

    if(memWrite.type !== 'global')
      throw `Memory write type missmatched.`;

    if(callerInfo.id !== this.currentNodeInfo!.id) {
      const hash = this.hashMemWrite(appId, memWrite);
      const signers = signs.map(s => crypto.recover(hash, s));
      const signerNodes = this.nodeManager.filterNodes({list: signers, isDeployer: true})
      const onlineDeployers:String[] = await this.system.getAvailableDeployers();
      const numRequiredSign = Math.max(
        this.netConfigs.tss.threshold,
        Math.round(onlineDeployers.length * 2 / 3),
      );
      if(signerNodes.length < numRequiredSign)
        throw `No enough signature to confirm global memory write`;
    }

    const lock = await this.mutex.lock(`mem-write:${this.getCacheKey(appId, memWrite.key)}`);
    try {
      let local:MemWrite|null = await this.readMem(appId, memWrite.key, "global");
      if(!local)
        throw `Memory write not initialized.`
      
      if(local.owner !== memWrite.owner)
        throw `Memory already writed with other node`;
      if(local.key === memWrite.key && local.value !== memWrite.value)
        throw `Memory already writed with other value`;

      await this.storeMemWrite(appId, memWrite);
    }
    finally {
      await lock.release()
    }
  }

  @remoteMethod(RemoteMethods.GlobalRead)
  async __readGlobal(data: {appId: string, key: string}, callerInfo: MuonNodeInfo): Promise<[string,string]|null> {
    const {appId, key} = data;
    const memWrire = await this.readMem(appId, key, "global");
    return memWrire ? [memWrire.owner, memWrire.value] : null;
  }
}

export default MemoryPlugin;
