import NodeCache from 'node-cache';
import { QueueProducer, QueueConsumer, IpcCallConfig } from '../message-bus'
import { MemoryRequest } from './types'

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

function startServer(config:IpcCallConfig) {
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

async function requestHandler(req:MemoryRequest) {
  let { action, key, value, ttl } = req;
  // console.log('SharedMemory request arrive', req);
  switch (action) {
    case 'SET':
      storage.set(key, value, ttl);
      return "Ok"
    case 'GET':
      return storage.get(key);
    case 'CLEAR':
      storage.del(key)
      return 'Ok'
    default:
      return "UNKNOWN_ACTION"
  }
}

async function set(key: string, value: any, ttl: number) {
  return await requestSender.send({action: 'SET', key, value, ttl}, defaultConfig.request)
}

async function get(key: string) {
  return await requestSender.send({action: 'GET', key}, defaultConfig.request)
}

async function clear(key: string) {
  return await requestSender.send({action: 'CLEAR', key}, defaultConfig.request)
}

export * from './types';
export {
  startServer,
  get,
  set,
  clear
}
