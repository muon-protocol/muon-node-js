const { QueueProducer } = require('../common/message-bus')
const { IPC_CHANNEL } = require('./plugins/network-ipc-plugin')

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method, params, options) {
  return callQueue.send({method, params}, options);
}

function forwardRemoteCall(peer, method, params, options) {
  return call("remote-call", {peer, method, params, options})
}

function reportClusterStatus(pid, status) {
  return call('report-cluster-status', {pid, status});
}

function assignTask(taskId) {
  return call("assign-task", {taskId})
}

function getLeader() {
  return call("get-leader")
}

function askClusterPermission(key, expireTime) {
  return call("ask-cluster-permission", {key, expireTime})
}

module.exports = {
  call,
  forwardRemoteCall,
  reportClusterStatus,
  assignTask,
  getLeader,
  askClusterPermission,
}
