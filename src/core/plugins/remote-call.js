const BasePlugin = require('./base/base-plugin.js')
const { forwardRemoteCall: forwardCallToNetwork } = require('../../networking/ipc')

class RemoteCall extends BasePlugin {
  handleCall(callId, method, params, callerWallet, responseStream, peerId){
    return this.emit(`${method}`, params, {wallet: callerWallet, peerId})
      .then(result => {
        let response = {
          responseId: callId,
          response: result
        };
        return response
      })
      .catch(error => {
        console.error("RemoteCall.handleCall", error)
        if(typeof error === "string")
          error = {message: error};
        const {message: ___, ...otherErrorParts} = error;
        let response = {
          responseId: callId,
          error: {
            message: error.message || 'Somethings went wrong',
            ...otherErrorParts
          }
        };
        return response
      })
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

  async call(peer, method, params, options={}){
    const {error, response} = await forwardCallToNetwork(peer, method, params, options)
    if(error)
      throw error;
    return response;
  }
}

module.exports = RemoteCall;
