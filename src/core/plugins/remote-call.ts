import BasePlugin from'./base/base-plugin.js'
import * as NetworkIpc from '../../network/ipc.js'
import Log from '../../common/muon-log.js'

const errorLog = Log('muon:core:plugins:remote-call:error')

export default class RemoteCall extends BasePlugin {
  async handleCall(callId, method, params, callerInfo, responseStream){
    try {
      // @ts-ignore
      return await this.emit(`${method}`, params, callerInfo)
    }catch (e) {
      errorLog("error happened %o %o", {method, params, callerInfo}, e)
      throw e
    }
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

  on(method, handler, options) {
    // console.log(`core.RemoteCall registering call handler`, {method, options})
    if(options.allowShieldNode) {
      NetworkIpc.allowRemoteCallByShieldNode(method, options).catch(e => {
        console.log(`network.RemoteCall.on: IPC call failed`, e)
      })
    }
    // @ts-ignore
    super.on(method, handler)
  }
}
