import NodeCache from 'node-cache';
import { QueueProducer, QueueConsumer, IpcCallConfig } from '../message-bus/index.js'
import { MemoryRequest } from './types.js'
import TimeoutPromise from "../timeout-promise.js"
import { deepFreeze } from '../../utils/helpers.js'

const CHANNEL = `muon-shared-memory-${process.env.SIGN_WALLET_ADDRESS}`
/**
 * @type {QueueConsumer}
 */
let requestReceiver:QueueConsumer<MemoryRequest>;
let requestSender = new QueueProducer(CHANNEL)

let defaultConfig:IpcCallConfig = {
  request: {
    timeout: 5000,
    timeoutMessage: "SharedMemory request timed out."
  }
};
deepFreeze(defaultConfig);

function startServer(config:IpcCallConfig={}) {
  defaultConfig = {
    ...defaultConfig,
    ... config
  };
  requestReceiver = new QueueConsumer(CHANNEL)
  requestReceiver.on('message', requestHandler)
}

const storage = new NodeCache({
  stdTTL: 0, // Keep for ever
  useClones: false,
});

const waitingPromises: {[index: string]: TimeoutPromise} = {
}

async function requestHandler(req:MemoryRequest) {
  let { action, key, value, ttl, timeout } = req;
  // console.log('SharedMemory request arrive', req);
  switch (action) {
    case 'SET':
      storage.set(key, value, ttl);
      if(waitingPromises[key])
        waitingPromises[key].resolve(value)
      delete waitingPromises[key]
      return "Ok"
    case 'GET':
      return storage.get(key);
    case "WGET":
      if(storage.has(key))
        return storage.get(key);
      else {
        waitingPromises[key] = new TimeoutPromise(timeout || 0, `waiting expired for shared data [${key}]`)
        return waitingPromises[key].promise;
      }
    case 'CLEAR':
      storage.del(key)
      return 'Ok'
    default:
      return "UNKNOWN_ACTION"
  }
}

async function set(key: string, value: any, ttl?: number) {
  return await requestSender.send({action: 'SET', key, value, ttl}, defaultConfig.request)
}

async function get(key: string) {
  return await requestSender.send({action: 'GET', key}, defaultConfig.request)
}

/**
 * Wait until the key exist and return the value
 * @param key {string} - key to return value
 * @param timeout {number} - returning promise will reject after this timeout (default `0`).
 */
async function waitAndGet(key, timeout: number=0) {
  let configs = defaultConfig.request
  if(!!timeout){
    configs = {
      ...configs,
      timeout
    }
  }
  return await requestSender.send({action: 'WGET', key, timeout}, configs)
}

async function clear(key: string) {
  return await requestSender.send({action: 'CLEAR', key}, defaultConfig.request)
}

export * from './types.js';
export {
  startServer,
  get,
  waitAndGet,
  set,
  clear
}
