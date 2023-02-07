import {NetworkIpcMethod, IpcMethods} from "./plugins/network-ipc-handler.js";
import { QueueProducer } from '../common/message-bus/index.js'
import { IPC_CHANNEL } from './plugins/network-ipc-plugin.js'
import {IpcCallOptions, JsonPeerInfo, MuonNodeInfo} from "../common/types";
import {NodeFilterOptions} from "./plugins/collateral-info";

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

function filterNodes(filter: NodeFilterOptions): Promise<MuonNodeInfo[]> {
  return call(IpcMethods.FilterNodes, filter);
}

function getOnlinePeers(): Promise<string[]> {
  return call(IpcMethods.GetOnlinePeers);
}

function broadcastToChannel(channel, message) {
  return call(IpcMethods.BroadcastToChannel, {channel, message})
}

function putDHT(key, value) {
  return call(IpcMethods.PutDHT, {key, value})
}

function getDHT(key) {
  return call(IpcMethods.GetDHT, {key})
}

function forwardRemoteCall(peer, method, params, options) {
  return call(IpcMethods.RemoteCall, {peer, method, params, options})
}

function getPeerInfo(peerId: string): JsonPeerInfo|null {
  // @ts-ignore
  return call(IpcMethods.GetPeerInfo, {peerId})
}

function getPeerInfoLight(peerId: string): JsonPeerInfo|null {
  // @ts-ignore
  return call(IpcMethods.GetPeerInfoLight, {peerId})
}

function getClosestPeer(peerId: string, cid: string): JsonPeerInfo|null {
  // @ts-ignore
  return call(IpcMethods.GetClosestPeer, {peerId, cid})
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

function getCurrentNodeInfo(): Promise<MuonNodeInfo|undefined> {
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

function findNOnlinePeer(peerIds: string[], count: number, options?: {timeout?: number, return?: string}): Promise<string[]> {
  return call(IpcMethods.FindNOnlinePeer, {peerIds, count, options})
}

function getConnectedPeerIds(): Promise<string[]> {
  return call(IpcMethods.GetConnectedPeerIds)
}

export {
  call,
  getCollateralInfo,
  filterNodes,
  getOnlinePeers,
  broadcastToChannel,
  forwardRemoteCall,
  getPeerInfo,
  getPeerInfoLight,
  getClosestPeer,
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
  findNOnlinePeer,
  getConnectedPeerIds,
  putDHT,
  getDHT
}
