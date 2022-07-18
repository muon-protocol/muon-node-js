const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, ipcMethod} = require('./base/app-decorators')
const {timeout} = require('@src/utils/helpers')

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
      throw "Remote method handler not defined"
    }
    return await this.remoteCallPlugin.handleCall(undefined, method, params, callerInfo.wallet, null, callerInfo.peerId)
  }

  @ipcMethod("get-tss-key")
  async __onGetTssKeyRequest(data={}, callerInfo) {
    let key = this.muon.getPlugin('tss-plugin').getSharedKey(data.keyId)
    await key.waitToFulfill()
    Object.keys(key.pubKeyParts).forEach(w => {
      key.pubKeyParts[w] = key.pubKeyParts[w].map(pubKey => pubKey.encode('hex'))
    })
    return key;
  }

  @ipcMethod("generate-tss-key")
  async __onGenerateTssKeyRequest(data={}, callerInfo) {
    let key = await this.muon.getPlugin('tss-plugin').keyGen(null, {id:data.keyId});
    Object.keys(key.pubKeyParts).forEach(w => {
      key.pubKeyParts[w] = key.pubKeyParts[w].map(pubKey => pubKey.encode('hex'))
    })
    return key;
  }
}

module.exports = CoreIpcHandlers
