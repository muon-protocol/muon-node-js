import {NetworkIpcMethod, IpcMethods} from "./plugins/network-ipc-handler.js";
import {MessagePublisher, QueueProducer} from '../common/message-bus/index.js'
import { IPC_CHANNEL } from './plugins/network-ipc-plugin.js'
import {AppContext, IpcCallOptions, JsonPeerInfo, MuonNodeInfo} from "../common/types";
import {NodeFilterOptions} from "./plugins/node-manager.js";
import {GatewayCallParams} from "../gateway/types";
import {MessageOptions} from "../common/message-bus/msg-publisher";
import {MapOf} from "../common/mpc/types";

export const GLOBAL_EVENT_CHANNEL = 'network-global-events'
const networkGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

export type NetworkGlobalEvent = {
  type: string,
  data: any
}

const callQueue = new QueueProducer(IPC_CHANNEL)

export function call(method: NetworkIpcMethod, params?, options?: IpcCallOptions): Promise<any> {
  return callQueue.send({method, params}, options);
}

export function fireEvent(event: NetworkGlobalEvent, options: MessageOptions={}) {
  networkGlobalEvents.send(event, options).catch(e => console.log(e))
}

export function getNetworkConfig(options?: IpcCallOptions) {
  return call(IpcMethods.GetNetworkConfig, {} , options);
}

export function getContractInfo(options?: IpcCallOptions) {
  return call(IpcMethods.GetContractInfo, {}, options)
}

export function filterNodes(filter: NodeFilterOptions, callOptions?: IpcCallOptions): Promise<MuonNodeInfo[]> {
  return call(IpcMethods.FilterNodes, filter, callOptions);
}

export function broadcastToChannel(channel, message) {
  return call(IpcMethods.BroadcastToChannel, {channel, message})
}

// export function putDHT(key, value) {
//   return call(IpcMethods.PutDHT, {key, value})
// }

// export function getDHT(key) {
//   return call(IpcMethods.GetDHT, {key})
// }

export function forwardCoreRemoteCall(peer, method, params, options) {
  return call(IpcMethods.ForwardCoreRemoteCall, {peer, method, params, options})
}

export function getPeerInfo(peerId: string): Promise<JsonPeerInfo|null> {
  // @ts-ignore
  return call(IpcMethods.GetPeerInfo, {peerId})
}

export function reportClusterStatus(pid, status) {
  return call(IpcMethods.ReportClusterStatus, {pid, status});
}

export function assignTask(taskId) {
  return call(IpcMethods.AssignTask, {taskId})
}

export function askClusterPermission(key: string, expireTime?: number) {
  let pid = process.pid;
  return call(IpcMethods.AskClusterPermission, {key, pid, expireTime})
}

export function forwardRequest(id, requestData: GatewayCallParams, appTimeout?:number) {
  return call(IpcMethods.ForwardGatewayRequest, {id, requestData, appTimeout});
}

export function getCurrentNodeInfo(options?: IpcCallOptions): Promise<MuonNodeInfo|undefined> {
  return call(IpcMethods.GetCurrentNodeInfo, null, options);
}

export function allowRemoteCallByShieldNode(method, options) {
  return call(IpcMethods.AllowRemoteCallByShieldNode, {method, options})
}

export function isCurrentNodeInNetwork() {
  return call(IpcMethods.IsCurrentNodeInNetwork)
}

export function subscribeToBroadcastChannel(channel: string) {
  return call(IpcMethods.SubscribeToBroadcastChannel, channel)
}

export function getUptime(options?: IpcCallOptions) {
  return call(IpcMethods.GetUptime, {} , options)
}

export function findNOnlinePeer(searchList: string[], count: number, options?: {timeout?: number, return?: string}): Promise<string[]> {
  return call(IpcMethods.FindNOnlinePeer, {searchList, count, options})
}

export function getNodeMultiAddress(options?: IpcCallOptions): Promise<string[]> {
  return call(IpcMethods.GetNodeMultiAddress, {} , options)
}

/**
 *
 * @param type {string} - type of data.
 * @param data - data to be stored on node.
 * @returns {Promise<string[]>} - The ID of the nodes that received the data.
 */
export function sendToAggregatorNode(type: string, data: any): Promise<string[]> {
  return call(IpcMethods.SendToAggregatorNode, {type, data})
}

export function addContextToLatencyCheck(context: AppContext) {
  return call(IpcMethods.AddContextToLatencyCheck, context);
}

export function getAppLatency(appId: string, seed: string): Promise<MapOf<number>> {
  return call(IpcMethods.GetAppLatency, {appId, seed});
}

export function isNodeOnline(node: string): Promise<boolean> {
  return call(IpcMethods.IsNodeOnline, node);
}
