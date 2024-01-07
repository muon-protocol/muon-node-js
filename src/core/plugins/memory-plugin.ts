import CallablePlugin from './base/callable-plugin.js'
import {getTimestamp} from '../../utils/helpers.js'
import { remoteApp } from './base/app-decorators.js'
import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"
import Web3 from 'web3'
import { remoteMethod } from '../../network/plugins/base/app-decorators.js'
import { MuonNodeInfo } from '../../common/types.js'
import NodeManagerPlugin from "./node-manager.js";
import * as PromiseLib from "../../common/promise-libs.js"
import _ from 'lodash'

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
}

export type MemReadOption = {
  distinct?: boolean,
  multi?: boolean
}

const RemoteMethods = {
  WriteGlobal: "write-global",
  ReadGlobal: "read-global",
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

  private get nodeManager(): NodeManagerPlugin{
    return this.muon.getPlugin('node-manager');
  }

  async writeLocalMem(key: string, value: string, ttl: number=0, options:MemWriteOptions={}) {
    let memWrite: MemWrite = {
      type: "local",
      owner: process.env.SIGN_WALLET_ADDRESS!,
      timestamp: getTimestamp(),
      ttl,
      key,
      value,
    }
    return await this.storeMemWrite(memWrite, options);
  }

  async readMem(key: string, type:MemWriteType): Promise<string|null> {
    return this.redisGet(`${this.keyPrefix}-${key}`)
      .then(strData => {
        try {
          const data:MemWrite = JSON.parse(strData)
          if(data.type !== type)
            return null
          return data.value;
        }
        catch(e) {
          return null;
        }
      })
  }

  async readLocalMem(key: string): Promise<string|null> {
    return this.readMem(key, "local")
  }

  private async storeMemWrite(memWrite: MemWrite, options:MemWriteOptions={}){
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
        const result = await this.redisGetset(`${this.keyPrefix}-${key}`, JSON.stringify(dataToSave))
        await this.redisExpire(`${this.keyPrefix}-${key}`, ttl)
        return result;
      }
      else {
        await this.redisSet(`${this.keyPrefix}-${key}`, JSON.stringify(dataToSave), 'EX', ttl)
      }
    }
    else {
      if(options.getset) {
        return await this.redisGetset(`${this.keyPrefix}-${key}`, JSON.stringify(memWrite));
      }
      else {
        await this.redisSet(`${this.keyPrefix}-${key}`, JSON.stringify(memWrite));
      }
    }
  }

  async writeGlobalMem(key: string, value: string, ttl: number=0, options:MemWriteOptions={}) {
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
    return PromiseLib.resolveN(
      this.netConfigs.tss.threshold,
      this.nodeManager.filterNodes({isDeployer: true}).map(({peerId, id}) => {
        return (
          id === this.currentNodeInfo?.id
          ?
          this.__writeGlobal(memWrite, this.currentNodeInfo)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.WriteGlobal,
            memWrite,
            {timeout: 5000},
          )
        )
      })
    )
  }

  async readGlobalMem(key: string): Promise<string|null> {
    let results:string[] = await PromiseLib.resolveN(
      this.netConfigs.tss.threshold,
      this.nodeManager.filterNodes({isDeployer: true}).map(({peerId, id}) => {
        return (
          id === this.currentNodeInfo!.id
          ?
          this.__readGlobal(key, this.currentNodeInfo!)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.ReadGlobal,
            key,
            {timeout: 5000},
          )
        )
      }),
      true
    )
    let uniqueResults = _.uniq(results.filter(r => !!r));
    if(uniqueResults.length !== 1)
      return null;
    return uniqueResults[0];
  }

  @remoteMethod(RemoteMethods.WriteGlobal)
  async __writeGlobal(memWrite: MemWrite, callerInfo: MuonNodeInfo) {
    if(memWrite.owner !== callerInfo.wallet)
      throw `Memory write owner missmatched.`
    if(memWrite.type !== 'global')
      throw `Memory write type missmatched.`
    return this.storeMemWrite(memWrite);
  }

  @remoteMethod(RemoteMethods.ReadGlobal)
  async __readGlobal(key: string, callerInfo: MuonNodeInfo): Promise<string|null> {
    return this.readMem(key, "global");
  }
}

export default MemoryPlugin;
