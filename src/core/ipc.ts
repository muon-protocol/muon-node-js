import {AppContext, AppDeploymentInfo, AppRequest, IpcCallOptions, MuonNodeInfo} from "../common/types";
import { QueueProducer, MessagePublisher } from '../common/message-bus/index.js'
import { BROADCAST_CHANNEL } from './plugins/broadcast.js'
import { IPC_CHANNEL } from './plugins/core-ipc-plugin.js'
import {MessageOptions} from "../common/message-bus/msg-publisher.js";
import {IpcMethods, CoreIpcMethod} from "./plugins/core-ipc-handlers.js";

const callQueue = new QueueProducer(IPC_CHANNEL)
const broadcastQueue = new QueueProducer(BROADCAST_CHANNEL)

export const GLOBAL_EVENT_CHANNEL = 'core-global-events'
const coreGlobalEvents = new MessagePublisher(GLOBAL_EVENT_CHANNEL)

export type CoreGlobalEvent = {
  type: string,
  data: any
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

export function broadcast(data: any, options: IpcCallOptions={}) {
  return broadcastQueue.send(data, options)
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
 * Return minimum time the app needs to confirm the request
 * @param appName
 */
export async function getAppTimeout(appName) {
  return await call(IpcMethods.GetAppTimeout, appName)
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

export async function shieldConfirmedRequest(request) {
  return await call(IpcMethods.ShieldConfirmedRequest, request);
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

export async function getNodeLastContextTime(node: string): Promise<number|undefined> {
  return call(IpcMethods.GetNodeLastContextTime, node);
}
