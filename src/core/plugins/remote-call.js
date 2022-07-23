const BasePlugin = require('./base/base-plugin.js')
const NetworkingIpc = require('../../networking/ipc')

class RemoteCall extends BasePlugin {
  async handleCall(callId, method, params, callerWallet, responseStream, peerId){
    return await this.emit(`${method}`, params, {wallet: callerWallet, peerId})
  }

  /**
   * @param peer
   * @param method
   * @param params
   * @param options
   * @param options.timeout
   * @param options.timeoutMessage
   * @param options.taskId
   * @returns {Promise<*>}
   */

  call(peer, method, params, options={}){
    return NetworkingIpc.forwardRemoteCall(peer, method, params, options)
  }
}

module.exports = RemoteCall;
