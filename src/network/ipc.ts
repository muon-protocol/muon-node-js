import {NetworkIpcMethod, IpcMethods} from "./plugins/network-ipc-handler.js";
import { QueueProducer } from '../common/message-bus/index.js'
import { IPC_CHANNEL } from './plugins/network-ipc-plugin.js'
import {IpcCallOptions} from "../common/types";

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method: NetworkIpcMethod, params?, options?: IpcCallOptions) {
  return callQueue.send({method, params}, options);
}

function getCollateralInfo(options?: IpcCallOptions) {
  return call(
    IpcMethods.GetCollateralInfo,
    {},
    {
      timeout: 5000,
      timeoutMessage: "Getting collateral info timed out",
      ...options
    })
}

function getOnlinePeers(): Promise<string[]> {
  return call(IpcMethods.GetOnlinePeers);
}

function broadcastToChannel(channel, message) {
  return call(IpcMethods.BroadcastToChannel, {channel, message})
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

function askClusterPermission(key, expireTime) {
  return call(IpcMethods.AskClusterPermission, {key, expireTime})
}

function provideContent(cids: string | string[]): Promise<any> {
  return call(IpcMethods.ContentRoutingProvide, cids)
}

function findContent(cid: string): Promise<any> {
  return call(IpcMethods.ContentRoutingFind, cid)
}

function forwardRequest(id, requestData, appTimeout?:number) {
  return call(IpcMethods.ForwardGatewayRequest, {id, requestData, appTimeout});
}

function getCurrentNodeInfo() {
  return call(IpcMethods.GetCurrentNodeInfo);
}

function allowRemoteCallByShieldNode(method, options) {
  return call(IpcMethods.AllowRemoteCallByShieldNode, {method, options})
}

function isCurrentNodeInNetwork() {
  return call(IpcMethods.IsCurrentNodeInNetwork)
}

function subscribeToBroadcastChannel(channel: string) {
  return call(IpcMethods.SubscribeToBroadcastChannel, channel)
}

function getUptime() {
  return call(IpcMethods.GetUptime)
}

export {
  call,
  getCollateralInfo,
  getOnlinePeers,
  broadcastToChannel,
  forwardRemoteCall,
  reportClusterStatus,
  assignTask,
  askClusterPermission,
  provideContent,
  findContent,
  forwardRequest,
  getCurrentNodeInfo,
  allowRemoteCallByShieldNode,
  isCurrentNodeInNetwork,
  subscribeToBroadcastChannel,
  getUptime,
}
