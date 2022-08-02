const { QueueProducer } = require('../common/message-bus')
const { IPC_CHANNEL } = require('./plugins/network-ipc-plugin')
import {IpcCallOptions} from "../common/types";

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method, params?, options?: IpcCallOptions) {
  return callQueue.send({method, params}, options);
}

function getOnlinePeers(): Promise<string[]> {
  return call("get-online-peers");
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

function provideContent(cids: string[]): Promise<any> {
  return call("content-routing-provide", cids)
}

function findContent(cid: string): Promise<any> {
  return call("content-routing-find", cid)
}

export {
  call,
  getOnlinePeers,
  forwardRemoteCall,
  reportClusterStatus,
  assignTask,
  getLeader,
  askClusterPermission,
  provideContent,
  findContent,
}
