import BasePlugin from './base/base-plugin.js'
import { QueueConsumer } from '../../common/message-bus/index.js'
import { logger } from '@libp2p/logger'
import {CORE_REQUEST_QUEUE_CHANNEL} from "../ipc.js";

const log = logger('muon:core:plugins:gateway-interface')
let gatewayRequests;

export default class GatewayInterface extends BasePlugin{

  async onStart(){
    if(!!process.env.GATEWAY_PORT) {
      gatewayRequests = new QueueConsumer(CORE_REQUEST_QUEUE_CHANNEL);
      gatewayRequests.on("message", this.__onGatewayCall.bind(this));
    }
  }

  async __handleCallResponse(callingArgs, response){
    if(response?.confirmed){
      try {
        // @ts-ignore
        await this.emit('confirmed', response)
      }
      catch (e) {}
    }
  }

  getActualHandlerMethod(app, method) {
    if(app){
      // @ts-ignore
      if(this.listenerCount(`call/${app}/${method}`) > 0){
        return method
      }
      // @ts-ignore
      else if(this.listenerCount(`call/${app}/default`) > 0){
        return 'default'
      }
      /** return undefined */
    }
    /** return undefined */
  }

  async __onGatewayCall(message, {pid, uid: callId}){
    // console.log("GatewayInterface.__onGatewayCall", message)
    try {
      let {app, method, params, nSign, mode="sign", gwSign, fee} = message
      if(!['sign', 'view'].includes(mode)){
        throw {message: `Invalid call mode: ${mode}`}
      }
      let response
      const callingArgs = {app, method, params, nSign, mode, callId, gwSign, fee}
      if(app){
        // @ts-ignore
        if(this.listenerCount(`call/${app}/${method}`) > 0){
          // @ts-ignore
          response = await this.emit(`call/${app}/${method}`, callingArgs)
        }
        // @ts-ignore
        else if(this.listenerCount(`call/${app}/default`) > 0){
          // @ts-ignore
          response = await this.emit(`call/${app}/default`, callingArgs)
        }
        else{
          throw {message: `app:[${app}] method:[${method}] handler not defined`}
        }
      }
      else{
        // @ts-ignore
        response = await this.emit(`call/muon/${method}`, callingArgs)
      }
      // console.log("GatewayInterface.__onGatewayCall: calling __handleCallResponse")
      await this.__handleCallResponse(callingArgs, response);
      // console.log("GatewayInterface.__onGatewayCall: __handleCallResponse called")
      return response
    }
    catch (e) {
      if(typeof e === 'string')
        e = {message: e};
      log.error('gateway-interface error %o', e)

      let {message, data: errorData, ...otherProps} = e;
      throw {
        message: message || "GatewayInterface: Unknown error occurred",
        data: errorData,
        ...otherProps
      }
    }
  }

  registerAppCall(app, method, callback){
    log(`registering gateway method ... %o`, {app, method})
    // @ts-ignore
    this.on(`call/${app}/${method}`, callback)
  }

  registerMuonCall(method, callback){
    // @ts-ignore
    this.on(`call/muon/${method}`, callback)
  }
}
