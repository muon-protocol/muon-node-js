import {NetworkIpcMethod, IpcMethods} from "./plugins/network-ipc-handler";

const { QueueProducer } = require('../common/message-bus')
const { IPC_CHANNEL } = require('./plugins/network-ipc-plugin')
import {IpcCallOptions} from "../common/types";

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method: NetworkIpcMethod, params?, options?: IpcCallOptions) {
  return callQueue.send({method, params}, options);
}

function getCollateralInfo() {
  return call(
    IpcMethods.GetCollateralInfo,
    {},
    {
      timeout: 5000,
      timeoutMessage: "Getting collateral info timed out"
    })
}

function getOnlinePeers(): Promise<string[]> {
  return call(IpcMethods.GetOnlinePeers);
}

function broadcastToChannel(channel, message) {
  return call(IpcMethods.BroadcastMessage, {channel, message})
}

function forwardRemoteCall(peer, method, params, options) {
  return call(IpcMethods.RemoteCall, {peer, method, params, options})
}

function reportClusterStatus(pid, status) {
  return call(IpcMethods.ReportClusterStatus, {pid, status});
}

function assignTask(taskId) {
  return call(IpcMethods.AssignTask, {taskId})
}

function getLeader() {
  return call(IpcMethods.GetLeader)
}

function askClusterPermission(key, expireTime) {
  return call(IpcMethods.AskClusterPermission, {key, expireTime})
}

function provideContent(cids: string[]): Promise<any> {
  return call(IpcMethods.ContentRoutingProvide, cids)
}

function findContent(cid: string): Promise<any> {
  return call(IpcMethods.ContentRoutingFind, cid)
}

export {
  call,
  getCollateralInfo,
  getOnlinePeers,
  broadcastToChannel,
  forwardRemoteCall,
  reportClusterStatus,
  assignTask,
  getLeader,
  askClusterPermission,
  provideContent,
  findContent,
}
