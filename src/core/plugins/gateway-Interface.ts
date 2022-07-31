import BasePlugin from './base/base-plugin'
const { QueueConsumer } = require('../../common/message-bus')
const { promisify } = require("util");
const Redis = require('redis');

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
  console.error(error);
});
callRedis.on("error", function(error) {
  console.error(error);
});
responseRedis.on('error', function(error) {
  console.error(error);
})

let gatewayRequests;

export default class GatewayInterface extends BasePlugin{

  async __handleCallResponse(response){
    if(response.confirmed){
      await this.emit('confirmed', response)
    }
  }

  async __onGatewayCall(message, {pid, uid: callId}){
    // console.log("GatewayInterface.__onGatewayCall", message)
    try {
      let {app, method, params, nSign, mode, gwSign} = message
      if(!['sign', 'view'].includes(mode)){
        throw {message: `Invalid call mode: ${mode}`}
      }
      let response
      if(app){
        if(this.listenerCount(`call/${app}/${method}`) > 0){
          response = await this.emit(`call/${app}/${method}`, {method, params, nSign, mode, callId, gwSign})
        }
        else if(this.listenerCount(`call/${app}/request`) > 0){
          response = await this.emit(`call/${app}/request`, {method, params, nSign, mode, callId, gwSign})
        }
        else{
          throw {message: `app:[${app}] method:[${method}] handler not defined`}
        }
      }
      else{
        response = await this.emit(`call/muon/${method}`, {method, params, nSign, mode, callId})
      }
      await this.__handleCallResponse(response);
      return response
    }
    catch (e) {
      if(typeof e === 'string')
        e = {message: e};
      // console.error('gateway-interface error')
      // console.dir(e, {depth: null})
      let {message, data: errorData} = e;
      return {
        error: message || "GatewayInterface: Unknown error occurred",
        data: errorData,
      }
    }
  }

  registerAppCall(app, method, callback){
    this.on(`call/${app}/${method}`, callback)
  }

  registerMuonCall(method, callback){
    this.on(`call/muon/${method}`, callback)
  }

  async onStart(){
    if(!!process.env.GATEWAY_PORT) {
      gatewayRequests = new QueueConsumer(`gateway-requests`);
      gatewayRequests.on("message", this.__onGatewayCall.bind(this));
      // callRedis.subscribe(GATEWAY_CALL_REQUEST)
      // callRedis.on('message', this.__onGatewayCall.bind(this))
    }
  }
}
