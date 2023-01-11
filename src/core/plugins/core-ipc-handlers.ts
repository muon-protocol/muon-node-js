import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators.js'
import System from "./system.js";
import AppManager from "./app-manager.js";
import GatewayInterface from "./gateway-Interface.js";
import BaseAppPlugin from "./base/base-app-plugin.js";
import {timeout} from '../../utils/helpers.js'

export const IpcMethods = {
  ForwardRemoteCall: 'forward-remote-call',
  GenerateTssKey: 'generate-tss-key',
  GetTssKey: 'get-tss-key',
  GetAppId: 'get-app-id',
  GetAppContext: 'get-app-context',
  GetAppTimeout: 'get-app-timeout',
  QueryAppContext: 'query-app-context',
  IsDeploymentExcerpt: 'is-deployment-excerpt',
  ShieldConfirmedRequest: 'shield-confirmed-request',
  EnsureAppTssKeyExist: 'ensure-app-tss-key-exist',
} as const;
type IpcKeys = keyof typeof IpcMethods;
export type CoreIpcMethod = typeof IpcMethods[IpcKeys];

@remoteApp
class CoreIpcHandlers extends CallablePlugin {

  get remoteCallPlugin() {
    return this.muon.getPlugin('remote-call');
  }

  get systemPlugin(): System {
    return this.muon.getPlugin('system');
  }

  get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  @ipcMethod(IpcMethods.ForwardRemoteCall)
  async __onRemoteCallForward({data, callerInfo}) {
    // console.log(`CoreIpcHandlers.__onRemoteCallForward`, data, callerInfo)
    const {method, params, options} = data;
    if(this.remoteCallPlugin.listenerCount(method) < 1){
      throw `Remote method [${method}] handler not defined`
    }
    return await this.remoteCallPlugin.handleCall(undefined, method, params, callerInfo, null)
  }

  @ipcMethod(IpcMethods.GetTssKey)
  async __onGetTssKeyRequest(data: {keyId: string}, callerInfo) {
    let key = await this.muon.getPlugin('tss-plugin').getSharedKey(data.keyId)
    return key.toSerializable();
  }

  @ipcMethod(IpcMethods.GenerateTssKey)
  async __onGenerateTssKeyRequest(data: {keyId?: string}, callerInfo) {
    let key = await this.muon.getPlugin('tss-plugin').keyGen(null, {id:data.keyId});
    Object.keys(key.pubKeyParts).forEach(w => {
      key.pubKeyParts[w] = key.pubKeyParts[w].map(pubKey => pubKey.encode('hex'))
    })
    return key;
  }

  @ipcMethod(IpcMethods.GetAppId)
  async __onGetAppId(data: {appName: string}): Promise<string> {
    const appId = this.muon.getAppIdByName(data.appName)
    return appId || "0";
  }

  /**
   * Return local app context
   * @param appName
   */
  @ipcMethod(IpcMethods.GetAppContext)
  async __getAppContext(appName: string) {
    const appId = await this.muon.getAppIdByName(appName)
    if(appId === '0')
      return null;
    return await this.appManager.getAppContext(appId)
  }

  /**
   * Return local app context
   * @param appName
   */
  @ipcMethod(IpcMethods.GetAppTimeout)
  async __getAppTimeout(appName: string) {
    const app = await this.muon.getAppByName(appName)
    if(!app)
      return 0;
    return app.requestTimeout || 0
  }

  /**
   * If app context not found locally, it's need to query muon network to find it.
   * @param appName
   */
  @ipcMethod(IpcMethods.QueryAppContext)
  async __queryAppContext(appName: string) {
    const appId = await this.__onGetAppId({appName})
    if(appId === '0')
      return null;
    return await this.appManager.queryAndLoadAppContext(appId)
  }

  @ipcMethod(IpcMethods.IsDeploymentExcerpt)
  async __isDeploymentExcerpt(data: {appName: string, method: string}) {
    const gp: GatewayInterface = this.muon.getPlugin('gateway-interface')
    return gp.getActualHandlerMethod(data.appName, data.method) !== 'request'
  }

  @ipcMethod(IpcMethods.ShieldConfirmedRequest)
  async __shieldConfirmedRequest(request) {
    const app: BaseAppPlugin = this.muon.getAppById(request.appId)
    if(!app)
      throw `CoreIpcHandler.__shieldConfirmedRequest Error: app not found ${request.appId}`
    return await app.shieldConfirmedRequest(request)
  }

  @ipcMethod(IpcMethods.EnsureAppTssKeyExist)
  async __ensureAppTssKeyExist(appId: string) {
    console.log(`CoreIpcHandler.__ensureAppTssKeyExist`, {appId})
    if(this.appManager.appHasTssKey(appId))
      return true;
    const tssKey = this.appManager.queryAndLoadAppTssKey(appId);
    return !!tssKey;
  }
}

export default CoreIpcHandlers
