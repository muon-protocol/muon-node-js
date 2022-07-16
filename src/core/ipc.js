const { QueueProducer, MessagePublisher } = require('../commot/message-bus')
const { BROADCAST_CHANNEL } = require('./plugins/broadcast')
const { IPC_CHANNEL } = require('./plugins/core-ipc-plugin')

const callQueue = new QueueProducer(IPC_CHANNEL)
const broadcastQueue = new QueueProducer(BROADCAST_CHANNEL)

const GLOBAL_EVENT_CHANNEL = 'core-global-events'
const coreGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

function call(method, params, options) {
  return callQueue.send({method, params}, options);
}

function broadcast(data, options) {
  return broadcastQueue.send(data, options)
}

function fireEvent(type, ...args) {
  coreGlobalEvents.send({type, args})
}

module.exports = {
  call,
  broadcast,
  fireEvent,
  GLOBAL_EVENT_CHANNEL,
}
