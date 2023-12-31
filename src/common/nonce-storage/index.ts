import { QueueProducer, QueueConsumer } from './../message-bus/index.js'
import TimeoutPromise from "./../timeout-promise.js"
import { AppNonceBatchJson } from '../../utils/tss/app-nonce-batch.js';
import { MapOf } from './../mpc/types.js';
import { FrostCommitmentJson, FrostNonceJson } from '../mpc/dist-nonce.js';
import _ from 'lodash';
import { timeout } from '../../utils/helpers.js';

const CHANNEL = `muon-nonce-store-${process.env.SIGN_WALLET_ADDRESS}`

export type PutRequest = {
  action: "PUT",
  seed: string,
  appNonceBatch: AppNonceBatchJson,
  owner: string,
}

export type HasRequest = {
  action: "HAS",
  seed: string,
  owner: string,
}

export type GetPartnersRequest = {
  action: "GETPARTNERS",
  seed: string,
  owner: string,
}

export type PickIdxRequest = {
  action: "PICKIDX",
  seed: string,
  owner: string,
  timeout?: number,
  timeoutMessage?: string,
}

export type GetCommitmentRequest = {
  action: "GETCOMM",
  seed: string,
  owner: string,
  index: number,
}

export type GetNonceRequest = {
  action: "GETNONCE",
  seed: string,
  owner: string,
  index: number,
}

export type ClearNonceRequest = {
  action: "CLEAR",
  seed: string,
}

export type NonceStoreRequest = PutRequest | HasRequest | GetPartnersRequest 
  | PickIdxRequest | GetCommitmentRequest | GetNonceRequest | ClearNonceRequest;

/**
 * @type {QueueConsumer}
 */
let requestReceiver:QueueConsumer<NonceStoreRequest>;
let requestSender = new QueueProducer(CHANNEL)

const  defaultConfig = {
  timeout: 5000,
  timeoutMessage: "NonceStore request timed out."
};

function startServer() {
  requestReceiver = new QueueConsumer(CHANNEL)
  requestReceiver.on('message', requestHandler)
}

type StorageItem = {
  appNonceBatch: AppNonceBatchJson,
  index: number
}

function getCacheIndex(seed, owner): string {
  return `${seed}-${owner}`
}

// maps key => StorageItem
const storage: MapOf<MapOf<StorageItem>> = {};
const waitingPromises: {[index: string]: TimeoutPromise} = {
}

async function requestHandler(req:NonceStoreRequest) {
  // console.log('SharedMemory request arrive', req);
  switch (req.action) {
    case 'PUT': {
      let {seed, appNonceBatch, owner} = req as PutRequest;
      if(storage[seed] === undefined)
        storage[seed] = {};
      storage[seed][owner] = {
        appNonceBatch,
        index: 0
      }
      const cacheIndex = getCacheIndex(seed, owner);
      if(waitingPromises[cacheIndex])
        waitingPromises[cacheIndex].resolve(0);
      delete waitingPromises[cacheIndex];
      return "Ok"
    }
    case "HAS": {
      let {seed, owner} = req as HasRequest;
      return !!storage[seed] && !!storage[seed][owner] && storage[seed][owner].index < storage[seed][owner].appNonceBatch.nonceBatch.n;
    }
    case "GETPARTNERS": {
      let {seed, owner} = req as GetPartnersRequest;
      if(!storage[seed])
        return undefined;
      return storage[seed][owner]?.appNonceBatch?.nonceBatch?.partners;
    }
    case 'PICKIDX': {
      let {seed, owner, timeout, timeoutMessage} = req as PickIdxRequest;
      const cacheIndex = getCacheIndex(seed, owner);

      if(storage[seed][owner] === undefined) {
        waitingPromises[cacheIndex] = new TimeoutPromise(
          timeout || defaultConfig.timeout, 
          timeoutMessage || defaultConfig.timeoutMessage
        )
        return waitingPromises[cacheIndex].promise;
      }
      else {
        let index = storage[seed][owner].index;
        storage[seed][owner].index = storage[seed][owner].index + 1;
        return index;
      }

    }
    case "GETCOMM": {
      const {seed, owner, index} = req as GetCommitmentRequest;
      return storage[seed][owner].appNonceBatch.nonceBatch.nonces[index].commitments;
    }
    case "GETNONCE": {
      const {seed, owner, index} = req as GetNonceRequest;

      const nonce:FrostNonceJson = _.cloneDeep(storage[seed][owner].appNonceBatch.nonceBatch.nonces[index]);
      
      storage[seed][owner].appNonceBatch.nonceBatch.nonces[index].d = "used";
      storage[seed][owner].appNonceBatch.nonceBatch.nonces[index].e = "used";

      return nonce;
    }
    case 'CLEAR': {
      const {seed} = req as ClearNonceRequest;
      delete storage[seed]
      return 'Ok'
    }
    default:
      return "UNKNOWN_ACTION"
  }
}

async function put(seed: string, owner: string, appNonceBatch:AppNonceBatchJson): Promise<string> {
  return requestSender.send({action: 'PUT', seed, owner, appNonceBatch})
}

async function has(seed: string, owner: string): Promise<boolean> {
  return requestSender.send({action: 'HAS', seed, owner});
}
async function getPartners(seed: string, owner: string): Promise<string[]|undefined> {
  return requestSender.send({action: 'GETPARTNERS', seed, owner});
}

async function pickIndex(seed: string, owner: string, timeout?: number): Promise<number> {
  return requestSender.send({action: 'PICKIDX', seed, owner, timeout});
}

async function getCommitment(seed: string, owner: string, index: number): Promise<MapOf<FrostCommitmentJson>> {
  return requestSender.send({action: "GETCOMM", seed, owner, index}); 
}

async function getNonce(seed: string, owner: string, index: number): Promise<FrostNonceJson> {
  return requestSender.send({action: 'GETNONCE', seed, owner, index});
}

async function clearSeed(seed: string): Promise<any> {
  return requestSender.send({action: 'CLEAR', seed});
}

export {
  startServer,
  put,
  has,
  getPartners,
  pickIndex,
  getCommitment,
  getNonce,
  clearSeed,
}
