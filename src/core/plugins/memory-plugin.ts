import CallablePlugin from './base/callable-plugin.js'
import {getTimestamp} from '../../utils/helpers.js'
import { remoteApp } from './base/app-decorators.js'
import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"
import Web3 from 'web3'
import {muonSha3} from '../../utils/sha3.js'

export type MemWriteType = 'local'

export type MemWrite = {
  type: MemWriteType,
  key: string,
  owner: string,
  timestamp: number,
  ttl: number,
  nSign: number,
  data: any,
  hash: string,
  signatures: string[]
}

export type MemWriteOptions = {
  getset?:boolean,
}

export type MemReadOption = {
  distinct?: boolean,
  multi?: boolean
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

  async writeLocalMem(key: string, data: any, ttl: number=0, options:MemWriteOptions={}) {
    let memWrite: MemWrite = {
      type: "local",
      key,
      owner: process.env.SIGN_WALLET_ADDRESS!,
      timestamp: getTimestamp(),
      ttl,
      nSign: 0,
      data,
      hash: '',
      signatures: []
    }
    return await this.storeMemWrite(memWrite, options);
  }

  private async storeMemWrite(memWrite: MemWrite, options:MemWriteOptions={}){
    let {timestamp, key, ttl} = memWrite;
    if(!key)
      throw `MemoryPlugin.storeMemWrite ERROR: key not defined in MemWrite.`
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

  async readLocalMem(key) {
    return await this.redisGet(`${this.keyPrefix}-${key}`);
  }
}

export default MemoryPlugin;
