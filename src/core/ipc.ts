import {IpcCallOptions, MuonNodeInfo} from "../common/types";
const { QueueProducer, MessagePublisher } = require('../common/message-bus')
const { BROADCAST_CHANNEL } = require('./plugins/broadcast')
const { IPC_CHANNEL } = require('./plugins/core-ipc-plugin')
import DistributedKey from './plugins/tss-plugin/distributed-key'
import {MessageOptions} from "../common/message-bus/msg-publisher";

const callQueue = new QueueProducer(IPC_CHANNEL)
const broadcastQueue = new QueueProducer(BROADCAST_CHANNEL)

const GLOBAL_EVENT_CHANNEL = 'core-global-events'
const coreGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

export type CoreGlobalEvent = {
  type: string,
  data: any
}

/**
 * @param method {string} - ipc method name
 * @param params {Object} - params for ipc method
 * @param options - ipc call options
 * @param options.timeout - if response not receive after this timeout, call result will reject
 * @param options.timeoutMessage - define promise reject message
 * @param options.pid - define cluster PID to running ipc method
 * @returns {Promise<Object>}
 */
function call(method: string, params: any, options: IpcCallOptions={}) {
  return callQueue.send({method, params}, options);
}

function broadcast(data: any, options: IpcCallOptions) {
  return broadcastQueue.send(data, options)
}

function fireEvent(event: CoreGlobalEvent, options: MessageOptions={}) {
  coreGlobalEvents.send(event, options)
}

async function forwardRemoteCall(data: any, callerInfo: MuonNodeInfo, options: IpcCallOptions) {
  return await call('forward-remote-call', {data, callerInfo}, options);
}

async function generateTssKey(keyId?: string) {
  let key = await call('generate-tss-key', {keyId});
  // console.log("CoreIpc.generateTssKey", JSON.stringify(key,null, 2))
  // console.log("CoreIpc.generateTssKey", key.partners)
  return DistributedKey.load(null, key)
}

async function getTssKey(keyId: string, options: IpcCallOptions) {
  const key = await call('get-tss-key', {keyId}, options);
  return DistributedKey.load(null, key)
}

async function getAppId(appName: string): Promise<string> {
  return await call('get-app-id', {appName})
}

/**
 * Return local app context
 * @param appName
 */
async function getAppContext(appName) {
  return await call('get-app-context', appName)
}

/**
 * If app context not found locally, it's need to query muon network to find it.
 * @param appName
 */
async function queryAppContext(appName) {
  return await call('query-app-context', appName)
}

export {
  call,
  broadcast,
  fireEvent,
  forwardRemoteCall,
  generateTssKey,
  getTssKey,
  getAppId,
  getAppContext,
  queryAppContext,
  GLOBAL_EVENT_CHANNEL,
}
