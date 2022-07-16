const { QueueProducer } = require('../commot/message-bus')
const { IPC_CHANNEL } = require('./plugins/network-ipc-plugin')

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method, params, options) {
  return callQueue.send({method, params}, options);
}

function forwardRemoteCall(peer, method, params, options) {
  return call("remote-call", {peer, method, params, options})
}

function assignTask(taskId) {
  return call("assign-task", {taskId})
}

module.exports = {
  call,
  forwardRemoteCall,
  assignTask,
}
