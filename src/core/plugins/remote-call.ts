import BasePlugin from'./base/base-plugin'
const NetworkIpc = require('../../network/ipc')

export default class RemoteCall extends BasePlugin {
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
    return NetworkIpc.forwardRemoteCall(peer, method, params, options)
  }
}
