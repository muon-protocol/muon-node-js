import BasePlugin from './base/base-plugin.js'
import { QueueConsumer } from '../../common/message-bus/index.js'
import { promisify } from "util"
import Redis from 'redis'
import { logger } from '@libp2p/logger'

const log = logger('muon:core:plugins:gateway-interface')

const GATEWAY_CALL_REQUEST  = `/muon/gateway/${process.env.GATEWAY_PORT}/call/request`
const GATEWAY_CALL_RESPONSE = `/muon/gateway/${process.env.GATEWAY_PORT}/call/response`

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379
}

const redis = Redis.createClient(redisConfig);
const callRedis = Redis.createClient(redisConfig)
const responseRedis = Redis.createClient(redisConfig)
const blpopAsync = promisify(redis.blpop).bind(redis);
redis.on("error", function(error) {
  log.error("%o", error);
});
callRedis.on("error", function(error) {
  log.error("%o", error);
});
responseRedis.on('error', function(error) {
  log.error("%o", error);
})

let gatewayRequests;

export default class GatewayInterface extends BasePlugin{

  async onStart(){
    if(!!process.env.GATEWAY_PORT) {
      gatewayRequests = new QueueConsumer(`gateway-requests`);
      gatewayRequests.on("message", this.__onGatewayCall.bind(this));
      // callRedis.subscribe(GATEWAY_CALL_REQUEST)
      // callRedis.on('message', this.__onGatewayCall.bind(this))
    }
  }

  async __handleCallResponse(callingArgs, response){
    if(callingArgs.app === 'content')
      return ;
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
      else if(this.listenerCount(`call/${app}/request`) > 0){
        return 'request'
      }
      /** return undefined */
    }
    /** return undefined */
  }

  async __onGatewayCall(message, {pid, uid: callId}){
    // console.log("GatewayInterface.__onGatewayCall", message)
    try {
      let {app, method, params, nSign, mode, gwSign} = message
      if(!['sign', 'view'].includes(mode)){
        throw {message: `Invalid call mode: ${mode}`}
      }
      let response
      const callingArgs = {app, method, params, nSign, mode, callId, gwSign}
      if(app){
        // @ts-ignore
        if(this.listenerCount(`call/${app}/${method}`) > 0){
          // @ts-ignore
          response = await this.emit(`call/${app}/${method}`, callingArgs)
        }
        // @ts-ignore
        else if(this.listenerCount(`call/${app}/request`) > 0){
          // @ts-ignore
          response = await this.emit(`call/${app}/request`, callingArgs)
        }
        else{
          throw {message: `app:[${app}] method:[${method}] handler not defined`}
        }
      }
      else{
        // @ts-ignore
        response = await this.emit(`call/muon/${method}`, callingArgs)
      }
      console.log("GatewayInterface.__onGatewayCall: calling __handleCallResponse")
      await this.__handleCallResponse(callingArgs, response);
      console.log("GatewayInterface.__onGatewayCall: __handleCallResponse called")
      return response
    }
    catch (e) {
      if(typeof e === 'string')
        e = {message: e};
      log.error('gateway-interface error %O')

      let {message, data: errorData, ...otherProps} = e;
      throw {
        message: message || "GatewayInterface: Unknown error occurred",
        data: errorData,
        ...otherProps
      }
    }
  }

  registerAppCall(app, method, callback){
    // @ts-ignore
    this.on(`call/${app}/${method}`, callback)
  }

  registerMuonCall(method, callback){
    // @ts-ignore
    this.on(`call/muon/${method}`, callback)
  }
}
