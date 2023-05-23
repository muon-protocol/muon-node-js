import {NetworkIpcMethod, IpcMethods} from "./plugins/network-ipc-handler.js";
import { QueueProducer } from '../common/message-bus/index.js'
import { IPC_CHANNEL } from './plugins/network-ipc-plugin.js'
import {IpcCallOptions, JsonPeerInfo, MuonNodeInfo} from "../common/types";
import {NodeFilterOptions} from "./plugins/node-manager.js";
import {GatewayCallParams} from "../gateway/types";

const callQueue = new QueueProducer(IPC_CHANNEL)

function call(method: NetworkIpcMethod, params?, options?: IpcCallOptions): Promise<any> {
  return callQueue.send({method, params}, options);
}

function getNetworkConfig(options?: IpcCallOptions) {
  return call(IpcMethods.GetNetworkConfig, {} , options);
}

function getContractInfo(options?: IpcCallOptions) {
  return call(IpcMethods.GetContractInfo, {}, options)
}

function filterNodes(filter: NodeFilterOptions, callOptions?: IpcCallOptions): Promise<MuonNodeInfo[]> {
  return call(IpcMethods.FilterNodes, filter, callOptions);
}

function broadcastToChannel(channel, message) {
  return call(IpcMethods.BroadcastToChannel, {channel, message})
}

// function putDHT(key, value) {
//   return call(IpcMethods.PutDHT, {key, value})
// }

// function getDHT(key) {
//   return call(IpcMethods.GetDHT, {key})
// }

function forwardCoreRemoteCall(peer, method, params, options) {
  return call(IpcMethods.ForwardCoreRemoteCall, {peer, method, params, options})
}

function getPeerInfo(peerId: string): Promise<JsonPeerInfo|null> {
  // @ts-ignore
  return call(IpcMethods.GetPeerInfo, {peerId})
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

function forwardRequest(id, requestData: GatewayCallParams, appTimeout?:number) {
  return call(IpcMethods.ForwardGatewayRequest, {id, requestData, appTimeout});
}

function getCurrentNodeInfo(options?: IpcCallOptions): Promise<MuonNodeInfo|undefined> {
  return call(IpcMethods.GetCurrentNodeInfo, null, options);
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

function getUptime(options?: IpcCallOptions) {
  return call(IpcMethods.GetUptime, {} , options)
}

function findNOnlinePeer(peerIds: string[], count: number, options?: {timeout?: number, return?: string}): Promise<string[]> {
  return call(IpcMethods.FindNOnlinePeer, {peerIds, count, options})
}

function getNodeMultiAddress(options?: IpcCallOptions): Promise<string[]> {
  return call(IpcMethods.GetNodeMultiAddress, {} , options)
}

/**
 *
 * @param type {string} - type of data.
 * @param data - data to be stored on node.
 * @returns {Promise<string[]>} - The ID of the nodes that received the data.
 */
function sendToAggregatorNode(type: string, data: any): Promise<string[]> {
  return call(IpcMethods.SendToAggregatorNode, {type, data})
}

export {
  call,
  getNetworkConfig,
  getContractInfo,
  filterNodes,
  broadcastToChannel,
  forwardCoreRemoteCall,
  getPeerInfo,
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
  getNodeMultiAddress,
  sendToAggregatorNode,
  // putDHT,
  // getDHT
}
