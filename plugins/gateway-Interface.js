const BasePlugin = require('./base/base-plugin')
const { promisify } = require("util");
const Redis = require('redis');

const GATEWAY_CALL_REQUEST  = `/muon/${process.env.PEER_ID}/gateway/${process.env.REDIS_GATEWAY_CHANNEL}/call/request`
const GATEWAY_CALL_RESPONSE = `/muon/${process.env.PEER_ID}/gateway/${process.env.REDIS_GATEWAY_CHANNEL}/call/response`

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
        let {callId, app, method, params} = data
        let response
        if(app){
          response = await this.emit(`call/${app}/${method}`, params)
        }
        else{
          response = await this.emit(`call/muon/${method}`, params)
        }
        await this.__handleCallResponse(data, response)
      }
      catch (e) {
        // console.error('gateway-interface error', e)
        responseRedis.publish(GATEWAY_CALL_RESPONSE, JSON.stringify({
          responseId: data ? data.callId : undefined,
          error: e.message,
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
    callRedis.subscribe(GATEWAY_CALL_REQUEST)
    callRedis.on('message', this.__onGatewayCall.bind(this))

    while (true) {
      try {
        let [queue, dataStr] = await blpopAsync(process.env.REDIS_QUEUE, 0)
        let data = JSON.parse(dataStr);
        if(data) {
          this.__onData(data)
        }
      }catch (e) {
        console.error(e)
      }
    }
  }
}

module.exports = GatewayInterface;
