import {AppContext, AppDeploymentInfo, AppRequest, IpcCallOptions, MuonNodeInfo} from "../common/types";
import { QueueProducer, MessagePublisher } from '../common/message-bus/index.js'
import { IPC_CHANNEL } from './plugins/core-ipc-plugin.js'
import {MessageOptions} from "../common/message-bus/msg-publisher.js";
import {IpcMethods, CoreIpcMethod} from "./plugins/core-ipc-handlers.js";
import {GatewayCallParams} from "../gateway/types";

const callQueue = new QueueProducer(IPC_CHANNEL)

export const GLOBAL_EVENT_CHANNEL = 'core-global-events'
const coreGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

export const CORE_REQUEST_QUEUE_CHANNEL = `core-request-queue`
let requestQueue = new QueueProducer(CORE_REQUEST_QUEUE_CHANNEL);

export type CoreGlobalEvent = {
  type: string,
  data: any
}

export async function enqueueAppRequest(requestData: GatewayCallParams, defaultOptions:IpcCallOptions={}): Promise<any> {
  const options:IpcCallOptions = {
    timeout: 60e3,
    timeoutMessage: "gateway timed out.",
    ...defaultOptions
  }
  return requestQueue.send(requestData, options);
}

/**
 * @param method {string} - ipc method name
 * @param params {Object} - params for ipc method
 * @param options - ipc call options
 * @param options.timeout - if response not receive after this timeout, call result will reject
 * @param options.timeoutMessage - define promise reject message
 * @param options.pid - define cluster PID to running ipc method
 * @returns {Promise<Object>}
 */
export function call(method: CoreIpcMethod, params: any, options: IpcCallOptions={}) {
  return callQueue.send({method, params}, options);
}

export function fireEvent(event: CoreGlobalEvent, options: MessageOptions={}) {
  coreGlobalEvents.send(event, options)
}

export async function execRemoteCall(data: any, callerInfo: MuonNodeInfo, options: IpcCallOptions) {
  return await call(IpcMethods.ExecRemoteCall, {data, callerInfo}, options);
}

export async function getAppId(appName: string): Promise<string> {
  return await call(IpcMethods.GetAppId, {appName})
}

/**
 * Return local app context
 * @param appName
 */
export async function getAppContext(appName: string, seed: string) {
  return await call(IpcMethods.GetAppContext, {appName, seed})
}

/**
 * Return local app context
 * @param appName
 */
export async function getAppOldestContext(appName: string): Promise<AppContext|undefined> {
  return await call(IpcMethods.GetAppOldestContext, {appName})
}

/**
 * If app context not found locally, it's need to query muon network to find it.
 * @param appName
 */
export async function queryAppAllContext(appName): Promise<AppContext[]> {
  return await call(IpcMethods.QueryAppAllContext, appName)
}

export async function isDeploymentExcerpt(appName, method) {
  return await call(IpcMethods.IsDeploymentExcerpt, {appName, method})
}

export async function ensureAppTssKeyExist(appId: string, seed: string) {
  return await call(IpcMethods.EnsureAppTssKeyExist, {appId, seed});
}

export async function findNAvailablePartners(appId: string, seed: string, searchList: string[], count: number) {
  return await call(IpcMethods.FindNAvailablePartners, {appId, seed, searchList, count})
}

export async function verifyRequestSignature(request: AppRequest) {
  return call(IpcMethods.VerifyRequestSignature, request);
}

export async function getAppDeploymentInfo(appId: string, seed: string): Promise<AppDeploymentInfo> {
  return call(IpcMethods.GetAppDeploymentInfo, {appId, seed});
}

export async function getNodeLastContextTime(node: string): Promise<number|null> {
  return call(IpcMethods.GetNodeLastContextTime, node);
}

export async function isDbSynced(): Promise<boolean> {
  return call(IpcMethods.IsDbSynced, {});
}

export async function GetNodesWithCommonSubnet(): Promise<string[]> {
  return call(IpcMethods.GetNodesWithCommonSubnet, {});
}
