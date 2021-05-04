const BasePlugin = require('./base-plugin')
const { promisify } = require("util");
const Redis = require('redis');

const GATEWAY_CALL_REQUEST  = `/muon/${process.env.PEER_ID}/gateway/call/request`
const GATEWAY_CALL_RESPONSE = `/muon/${process.env.PEER_ID}/gateway/call/response`

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

  async _onData(data){
    // console.log('gateway interface: ', data)
    this.emit('data', data)
    this.emit(`data/${data.type}`, data)
  }

  async onRedisMessage(channel, message){
    if(channel === GATEWAY_CALL_REQUEST){
      try {
        let {callId, method, params} = JSON.parse(message);
        let response = await this.emit(`call/${method}`, params)
        responseRedis.publish(GATEWAY_CALL_RESPONSE, JSON.stringify({
          responseId: callId,
          response,
        }))
      }
      catch (e) {
        console.error(e)
      }
    }
  }

  async onStart(){
    callRedis.subscribe(GATEWAY_CALL_REQUEST)
    callRedis.on('message', this.onRedisMessage.bind(this))

    while (true) {
      try {
        let [queue, dataStr] = await blpopAsync(process.env.REDIS_QUEUE, 0)
        let data = JSON.parse(dataStr);
        if(data) {
          this._onData(data)
        }
      }catch (e) {
        console.error(e)
      }
    }
  }
}

module.exports = GatewayInterface;
