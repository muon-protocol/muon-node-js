import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators'
const {timeout} = require('../../utils/helpers')

@remoteApp
class CoreIpcHandlers extends CallablePlugin {

  get remoteCallPlugin() {
    return this.muon.getPlugin('remote-call');
  }

  @ipcMethod("forward-remote-call")
  async __onRemoteCallForward({data, callerInfo}) {
    // console.log(`CoreIpcHandlers.__onRemoteCallForward`, data, callerInfo)
    const {method, params, options} = data;
    if(this.remoteCallPlugin.listenerCount(method) < 1){
      throw `Remote method [${method}] handler not defined`
    }
    return await this.remoteCallPlugin.handleCall(undefined, method, params, callerInfo.wallet, null, callerInfo.peerId)
  }

  @ipcMethod("get-tss-key")
  async __onGetTssKeyRequest(data: {keyId: string}, callerInfo) {
    let key = this.muon.getPlugin('tss-plugin').getSharedKey(data.keyId)
    await key.waitToFulfill()
    return key.toSerializable();
  }

  @ipcMethod("generate-tss-key")
  async __onGenerateTssKeyRequest(data: {keyId: string}, callerInfo) {
    let key = await this.muon.getPlugin('tss-plugin').keyGen(null, {id:data.keyId});
    Object.keys(key.pubKeyParts).forEach(w => {
      key.pubKeyParts[w] = key.pubKeyParts[w].map(pubKey => pubKey.encode('hex'))
    })
    return key;
  }

  @ipcMethod("get-app-id")
  async __onGetAppId(data: {appName: string}, callerInfo): Promise<string> {
    const app = this.muon._apps[data.appName]
    return !!app ? app.APP_ID : "0";
  }
}

export default CoreIpcHandlers
