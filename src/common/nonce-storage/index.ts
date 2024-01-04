import { QueueProducer, QueueConsumer } from './../message-bus/index.js'
import TimeoutPromise from "./../timeout-promise.js"
import { AppNonceBatchJson } from '../../utils/tss/app-nonce-batch.js';
import { MapOf } from './../mpc/types.js';
import { FrostCommitmentJson, FrostNonceJson } from '../mpc/dist-nonce.js';
import _ from 'lodash';
import {Mutex} from "../../common/mutex.js";
import { timeout } from '../../utils/helpers.js';

const CHANNEL = `muon-nonce-store-${process.env.SIGN_WALLET_ADDRESS}`
const mutex = new Mutex();

export type PutRequest = {seed: string, owner: string, appNonceBatch: AppNonceBatchJson}
export type HasRequest = {seed: string, owner: string}
export type GetPartnersRequest = {seed: string, owner: string, index: string}
export type PickIdxRequest = { seed: string, owner: string, timeout?: number, timeoutMessage?: string}
export type GetCommitmentRequest = {seed: string, owner: string, index: string,}
export type GetNonceRequest = {seed: string, owner: string, index: string,}
export type ClearNonceRequest = {seed: string,}

type WithAction<T, A extends string> = T & { action: A };

export type NonceStoreRequest = 
    WithAction<PutRequest, "PUT"> 
  | WithAction<HasRequest, 'HAS'> 
  | WithAction<GetPartnersRequest, 'GETPARTNERS'>  
  | WithAction<PickIdxRequest , 'PICKIDX'> 
  | WithAction<GetCommitmentRequest , 'GETCOMM'> 
  | WithAction<GetNonceRequest , 'GETNONCE'> 
  | WithAction<ClearNonceRequest, 'CLEAR'>;

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
  index: number,
  n: number,
}

function getCacheIndex(seed, owner): string {
  return `${seed}-${owner}`
}

// maps seed => owner => NonceBatch.id => StorageItem
const storage: MapOf<MapOf<MapOf<StorageItem>>> = {};
const waitingPromises: {[index: string]: TimeoutPromise} = {
}

async function requestHandler(req:NonceStoreRequest) {
  // console.log('SharedMemory request arrive', req);
  switch (req.action) {
    case 'PUT': {
      let {seed, appNonceBatch, owner} = req as PutRequest;
      if(storage[seed] === undefined)
        storage[seed] = {};
      if(storage[seed][owner] === undefined)
        storage[seed][owner] = {};
      storage[seed][owner][appNonceBatch.id] = {
        appNonceBatch,
        index: 0,
        n: appNonceBatch.nonceBatch.n,
      }
      // const cacheIndex = getCacheIndex(seed, owner);
      // if(waitingPromises[cacheIndex])
      //   waitingPromises[cacheIndex].resolve(0);
      // delete waitingPromises[cacheIndex];
      return "Ok"
    }
    case "HAS": {
      let {seed, owner} = req as HasRequest;
      if(!storage[seed] || !storage[seed][owner] || Object.keys(storage[seed][owner]).length === 0)
        return false;
      return Object.values(storage[seed][owner]).findIndex(item => item.index < item.n) >= 0
    }
    case 'PICKIDX': {
      let {seed, owner, timeout, timeoutMessage} = req as PickIdxRequest;
      const cacheIndex = getCacheIndex(seed, owner);

     if(!storage[seed] || !storage[seed][owner]) {
        return null;
      }
      else {
        const lock = await mutex.lock(`nonce-storrage-lock:${seed}-${owner}`);
        try {
          const item:StorageItem|undefined = Object.values(storage[seed][owner]).find(({n, index}) => index < n-1)
          if(!item)
            return null
          let index = item.index;
          storage[seed][owner][item.appNonceBatch.id].index = index + 1;
          return `${item.appNonceBatch.id}-${index}`;
        }
        finally {
          await lock.release()
        }
      }

    }
    case "GETPARTNERS": {
      let {seed, owner, index} = req as GetPartnersRequest;
      const [batchId, i] = index.split("-")
      if(!storage[seed])
        return undefined;
      return storage[seed][owner][batchId]?.appNonceBatch?.nonceBatch?.partners;
    }
    case "GETCOMM": {
      const {seed, owner, index} = req as GetCommitmentRequest;
      const [batchId, i] = index.split("-")
      if(parseInt(i) >= storage[seed][owner][batchId].appNonceBatch.nonceBatch.nonces.length)
        throw "nonce index is out of range."
      return storage[seed][owner][batchId].appNonceBatch.nonceBatch.nonces[i].commitments;
    }
    case "GETNONCE": {
      const {seed, owner, index} = req as GetNonceRequest;
      const [batchId, i] = index.split("-")

      const nonce:FrostNonceJson = _.cloneDeep(storage[seed][owner][batchId].appNonceBatch.nonceBatch.nonces[i]);
      
      storage[seed][owner][batchId].appNonceBatch.nonceBatch.nonces[i].d = "used";
      storage[seed][owner][batchId].appNonceBatch.nonceBatch.nonces[i].e = "used";

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

async function put(req: PutRequest): Promise<string> {
  return requestSender.send({action: 'PUT', ...req})
}

async function has(req: HasRequest): Promise<boolean> {
  return requestSender.send({action: 'HAS', ...req});
}
async function getPartners(req: GetPartnersRequest): Promise<string[]|undefined> {
  return requestSender.send({action: 'GETPARTNERS', ...req});
}

async function pickIndex(req: PickIdxRequest): Promise<string> {
  return requestSender.send({action: 'PICKIDX', ...req});
}

async function getCommitment(req: GetCommitmentRequest): Promise<MapOf<FrostCommitmentJson>> {
  return requestSender.send({action: "GETCOMM", ...req}); 
}

async function getNonce(req: GetNonceRequest): Promise<FrostNonceJson> {
  return requestSender.send({action: 'GETNONCE', ...req});
}

async function clearSeed(req: ClearNonceRequest): Promise<any> {
  return requestSender.send({action: 'CLEAR', ...req});
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
