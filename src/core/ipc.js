const { QueueProducer, MessagePublisher } = require('../common/message-bus')
const { BROADCAST_CHANNEL } = require('./plugins/broadcast')
const { IPC_CHANNEL } = require('./plugins/core-ipc-plugin')
const DistributedKey = require('./plugins/tss-plugin/distributed-key')

const callQueue = new QueueProducer(IPC_CHANNEL)
const broadcastQueue = new QueueProducer(BROADCAST_CHANNEL)

const GLOBAL_EVENT_CHANNEL = 'core-global-events'
const coreGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

/**
 * @param method {string} - ipc method name
 * @param params {Object} - params for ipc method
 * @param options - ipc call options
 * @param options.timeout - if response not receive after this timeout, call result will reject
 * @param options.timeoutMessage - define promise reject message
 * @param options.rawResponse - will return ipc call raw response instead of ipc method returning value
 * @param options.pid - define cluster PID to running ipc method
 * @returns {Promise<Object>}
 */
function call(method, params, options) {
  return callQueue.send({method, params}, options);
}

function broadcast(data, options) {
  return broadcastQueue.send(data, options)
}

function fireEvent(type, ...args) {
  coreGlobalEvents.send({type, args})
}

async function generateTssKey(keyId) {
  let key = await this.call('generate-tss-key', {keyId}, {});
  // console.log("CoreIpc.generateTssKey", JSON.stringify(key,null, 2))
  // console.log("CoreIpc.generateTssKey", key.partners)
  return DistributedKey.load(null, key)
}

async function getTssKey(keyId, options={}) {
  const key = await this.call('get-tss-key', {keyId}, options);
  return DistributedKey.load(null, key)
}

module.exports = {
  call,
  broadcast,
  fireEvent,
  generateTssKey,
  getTssKey,
  GLOBAL_EVENT_CHANNEL,
}