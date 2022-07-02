const BasePlugin = require('./base/base-plugin')
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

class GatewayInterface extends BasePlugin{

  async __onData(data){
    // console.log('gateway interface: ', data)
    this.emit('data', data)
    this.emit(`data/${data.type}`, data)
  }

  async __handleCallResponse(callData, response){
    let {callId, app, method, params} = callData;

    if(response.confirmed){
      await this.emit('confirmed', response)
    }

    responseRedis.publish(GATEWAY_CALL_RESPONSE, JSON.stringify({
      responseId: callId,
      response,
    }))
  }

  async __onGatewayCall(channel, message){
    let data
    if(channel === GATEWAY_CALL_REQUEST){
      try {
        data = JSON.parse(message);
        let {callId, app, method, params, nSign, mode} = data
        if(!['sign', 'view'].includes(mode)){
          throw {message: `Invalid call mode: ${mode}`}
        }
        let response
        if(app){
          if(this.listenerCount(`call/${app}/${method}`) > 0){
            response = await this.emit(`call/${app}/${method}`, params, nSign, mode, callId)
          }
          else if(this.listenerCount(`call/${app}/request`) > 0){
            response = await this.emit(`call/${app}/request`, method, params, nSign, mode, callId)
          }
          else{
            throw {message: `app:[${app}] method:[${method}] handler not defined`}
          }
        }
        else{
          response = await this.emit(`call/muon/${method}`, params, nSign, mode, callId)
        }
        await this.__handleCallResponse(data, response)
      }
      catch (e) {
        if(typeof e === 'string')
          e = {message: e};
        console.error('gateway-interface error')
        console.dir(e, {depth: null})
        let {message, data: errorData} = e;
        responseRedis.publish(GATEWAY_CALL_RESPONSE, JSON.stringify({
          responseId: data ? data.callId : undefined,
          error: message || "GatewayInterface: Unknown error occurred",
          data: errorData,
        }))
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
      callRedis.subscribe(GATEWAY_CALL_REQUEST)
      callRedis.on('message', this.__onGatewayCall.bind(this))

      // TODO: deprecated and will remove later.
      while (true) {
        try {
          let [queue, dataStr] = await blpopAsync(process.env.REDIS_QUEUE, 0)
          let data = JSON.parse(dataStr);
          if (data) {
            this.__onData(data)
          }
        } catch (e) {
          console.error(e)
        }
      }
    }
  }
}

module.exports = GatewayInterface;
