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
}

module.exports = CoreIpcHandlers
