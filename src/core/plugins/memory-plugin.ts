/**
 * This plugin provides some API for store and retrieving data in a shared memory on the Muon network.
 * Writing Data is distributed and will write on the all nodes local database. Reading data is locally
 * at the moment.
 *
 * There is three type of Data can be store in shared memory.
 *
 * 1) node: The owner of this type of MemoryWrite is the `calling node`. The collateral wallet of
 *          the Node will store in memory.  any other nodes can query for this data. This type of
 *          memory write can be done immediately by calling because it needs only the calling nodes
 *          signature.
 *
 * 2) app: The owner of this MemoryWrite is user Apps. The ID of the calling App will store in memory
 *          as the owner of Memory data. This type of MemoryWrite can be stored in memory after that
 *          all nodes (nodes that process the app request) sign the memory write. In the other word, Threshold Signature
 *          needed for this MemoryWrite. Because of the threshold signature, this MemoryWrite only can
 *          be stored when the request is processed successfully.
 *
 * 3) local: The owner of this memory is current node. This type of memory only stored on current node
 *          and does not broadcast to other nodes.
 *
 * Any node on the network can query for app|node types of data.
 */

import CallablePlugin from './base/callable-plugin.js'
import * as crypto from '../../utils/crypto.js'
import {getTimestamp} from '../../utils/helpers.js'
import Memory, {types as MemoryTypes} from '../../common/db-models/Memory.js'
import { remoteApp, broadcastHandler } from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info.js";
import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"
import Web3 from 'web3'

export type MemWriteType = 'app' | 'node' | 'local'

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

  broadcastWrite(memWrite: MemWrite) {
    this.broadcast({
      type: 'mem_write',
      peerId: process.env.PEER_ID,
      memWrite
    })
  }

  @broadcastHandler
  async onBroadcastReceived(data) {
    // console.log("MemoryPlugin.onBroadcastReceived", data)
    try {
      if (data && data.type === 'mem_write' && !!data.memWrite) {
        if(this.checkSignature(data.memWrite)){
          await this.storeMemWrite(data.memWrite);
        }
        else{
          console.log('memWrite signature mismatch', data.memWrite)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  checkSignature(memWrite: MemWrite){
    let collateralPlugin: CollateralInfoPlugin = this.muon.getPlugin('collateral');

    let {signatures} = memWrite;

    let hash = this.hashMemWrite(memWrite)
    if(hash !== memWrite.hash) {
      console.log('hash mismatch', [hash, memWrite.hash])
      return false
    }

    let allowedList = collateralPlugin.getAllowedWallets().map(addr => addr.toLowerCase());

    switch (memWrite.type) {
      case "app": {
        if(signatures.length < collateralPlugin.TssThreshold)
          throw "Insufficient MemWrite signature";
        let sigOwners: string[] = signatures.map(sig => crypto.recover(hash, sig).toLowerCase())
        console.log({sigOwners})
        let ownerIsValid: number[] = sigOwners.map(owner => (allowedList.indexOf(owner) >= 0 ? 1 : 0))
        let validCount: number = ownerIsValid.reduce((sum, curr) => (sum + curr), 0)
        return validCount >= collateralPlugin.TssThreshold;
      }
      case "node": {
        if(signatures.length !== 1){
          throw `Node MemWrite must have one signature. currently has ${signatures.length}.`;
        }
        const owner = crypto.recover(hash, signatures[0]).toLowerCase()
        return allowedList.indexOf(owner) >= 0;
      }
      default:
        throw `Unknown MemWrite type: ${memWrite.type}`
    }
  }

  hashMemWrite(memWrite: MemWrite) {
    let {type, owner, timestamp, ttl, nSign, data} = memWrite;
    let ownerIsWallet = type === MemoryTypes.Node;
    return crypto.soliditySha3([
      {type: 'string', value: type},
      {type: ownerIsWallet ? 'address' : 'string', value: owner},
      {type: 'uint256', value: timestamp},
      {type: 'uint256', value: ttl},
      {type: 'uint256', value: nSign},
      ... data.map(({type, value}) => ({type, value})),
    ])
  }

  /**
   * Method for saving APPs data in memory. This method can be called after all nodes
   * process the request. all nodes signature is needed to this data be saved.
   * @param request
   * @returns {Promise<void>}
   */
  async writeAppMem(request) {
    if(!request.data.memWrite)
      return;

    let {key, timestamp, ttl, nSign, data, hash} = request.data.memWrite;
    let signatures = request.signatures.map(sign => sign.memWriteSignature)
    let memWrite: MemWrite = {
      type: MemoryTypes.App,
      key,
      owner: request.app,
      timestamp,
      ttl,
      nSign,
      data,
      hash,
      signatures,
    }
    await this.storeMemWrite(memWrite);
    this.broadcastWrite(memWrite);
  }

  /**
   * Any node can call this to save a data into the shared memory.
   * only the node signature needed to this data be saved.
   * @param memory
   * @returns {Promise<void>}
   */
  async writeNodeMem(key: string, data: any, ttl: number=0) {
    let nSign=1,
      timestamp=getTimestamp();
    let memWrite: MemWrite = {
      type: MemoryTypes.Node,
      key,
      owner: process.env.SIGN_WALLET_ADDRESS!,
      timestamp,
      ttl,
      nSign,
      data,
      hash: '',
      signatures: []
    }
    memWrite.hash = this.hashMemWrite(memWrite)
    memWrite.signatures = [crypto.sign(memWrite.hash)]

    await this.storeMemWrite(memWrite);
    this.broadcastWrite(memWrite);
  }

  async writeLocalMem(key: string, data: any, ttl: number=0, options:MemWriteOptions={}) {
    let memWrite: MemWrite = {
      type: MemoryTypes.Local,
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
