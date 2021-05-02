const BasePlugin = require('./base-plugin')
const { promisify } = require("util");
const Redis = require('redis');

const redis = Redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379
});
const blpopAsync = promisify(redis.blpop).bind(redis);

redis.on("error", function(error) {
  console.error(error);
});

class GatewayInterface extends BasePlugin{

  async _onData(data){
    // console.log('gateway interface: ', data)
    this.emit('data', data)
    this.emit(`data/${data.type}`, data)
  }

  async onStart(){

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
