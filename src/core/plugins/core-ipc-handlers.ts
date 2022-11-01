import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators'
import System from "./system";
import AppManager from "./app-manager";
const {timeout} = require('../../utils/helpers')

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

  @ipcMethod("forward-remote-call")
  async __onRemoteCallForward({data, callerInfo}) {
    // console.log(`CoreIpcHandlers.__onRemoteCallForward`, data, callerInfo)
    const {method, params, options} = data;
    if(this.remoteCallPlugin.listenerCount(method) < 1){
      throw `Remote method [${method}] handler not defined`
    }
    return await this.remoteCallPlugin.handleCall(undefined, method, params, callerInfo, null)
  }

  @ipcMethod("get-tss-key")
  async __onGetTssKeyRequest(data: {keyId: string}, callerInfo) {
    let key = this.muon.getPlugin('tss-plugin').getSharedKey(data.keyId)
    await key.waitToFulfill()
    return key.toSerializable();
  }

  @ipcMethod("generate-tss-key")
  async __onGenerateTssKeyRequest(data: {keyId?: string}, callerInfo) {
    let key = await this.muon.getPlugin('tss-plugin').keyGen(null, {id:data.keyId});
    Object.keys(key.pubKeyParts).forEach(w => {
      key.pubKeyParts[w] = key.pubKeyParts[w].map(pubKey => pubKey.encode('hex'))
    })
    return key;
  }

  @ipcMethod("get-app-id")
  async __onGetAppId(data: {appName: string}): Promise<string> {
    const appId = this.muon.getAppIdByName(data.appName)
    return appId || "0";
  }

  /**
   * Return local app context
   * @param appName
   */
  @ipcMethod("get-app-context")
  async __getAppContext(appName: string) {
    const appId = await this.muon.getAppIdByName(appName)
    if(appId === '0')
      return null;
    return await this.appManager.getAppContext(appId)
  }

  /**
   * If app context not found locally, it's need to query muon network to find it.
   * @param appName
   */
  @ipcMethod("query-app-context")
  async __queryAppContext(appName: string) {
    const appId = await this.__onGetAppId({appName})
    if(appId === '0')
      return null;
    return await this.appManager.queryAndLoadAppContext(appId)
  }

  @ipcMethod("find-app-deployment-info")
  async __findAppDeploymentInfo(appId: string) {
  }
}

export default CoreIpcHandlers
