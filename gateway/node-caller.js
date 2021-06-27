const Redis = require('redis');
const {newCallId} = require('../utils/helpers')

const redisCongig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379
}
const callRedis = Redis.createClient(redisCongig);
const responseRedis = Redis.createClient(redisCongig);
const broadcastRedis = Redis.createClient(redisCongig);

const GATEWAY_CALL_REQUEST  = `/muon/${process.env.PEER_ID}/gateway/${process.env.REDIS_GATEWAY_CHANNEL}/call/request`
const GATEWAY_CALL_RESPONSE = `/muon/${process.env.PEER_ID}/gateway/${process.env.REDIS_GATEWAY_CHANNEL}/call/response`

callRedis.on("error", function(error) {
  console.error('callRedis', error.message);
});
responseRedis.on("error", function(error) {
  console.error('responseRedis', error.message);
});
broadcastRedis.on("error", function(error) {
  console.error('responseRedis', error.message);
});

responseRedis.subscribe(GATEWAY_CALL_RESPONSE)
responseRedis.on('message', (channel, message) => {
  if(channel === GATEWAY_CALL_RESPONSE){
    try {
      let {responseId, response, error} = JSON.parse(message);
      let callResult = calls[responseId]
      if(callResult) {
        if(error)
          callResult.reject(error)
        else
          callResult.resolve(response)
      }
    }
    catch (e) {
      console.error(e)
    }
  }
})

let calls = {}

function makeCall(method, params, nSign){
  let callId = newCallId();
  callRedis.publish(GATEWAY_CALL_REQUEST, JSON.stringify({callId, method, params, nSign}))
  let callResult = new CallResult()
  calls[callId] = callResult;
  return callResult.promise
}

function CallResult() {
  var self = this;
  this.promise = new Promise(function(resolve, reject) {
    self.reject = reject
    self.resolve = resolve
  })
}

function broadcast(data){
  let redisMessage = JSON.stringify(data)
  broadcastRedis.lpush(process.env.REDIS_QUEUE, redisMessage);
}

function appCall(app, method, params, nSign){
  let callId = newCallId();
  callRedis.publish(GATEWAY_CALL_REQUEST, JSON.stringify({callId, app, method, params, nSign}))
  let callResult = new CallResult()
  calls[callId] = callResult;
  return callResult.promise
}

module.exports = {
  GATEWAY_CALL_REQUEST,
  GATEWAY_CALL_RESPONSE,
  call: makeCall,
  appCall,
  broadcast
}
