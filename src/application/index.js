const Events = require('events-async');
const { promisify } = require("util");
const Redis = require('redis');

const MUON_APPLICATION_QUEUE_REQUEST  = "MUON_APPLICATION_QUEUE_REQUEST"
const MUON_APPLICATION_QUEUE_RESPONSE = "MUON_APPLICATION_QUEUE_RESPONSE"

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379
}

const requestRedis = Redis.createClient(redisConfig)
const responseRedis = Redis.createClient(redisConfig)
const blpopAsync = promisify(requestRedis.blpop).bind(requestRedis);

requestRedis.on("error", function(error) {
  console.error(error);
});
responseRedis.on('error', function(error) {
  console.error(error);
})

class Application extends Events {

  /**
   * @namespace
   * @property {Object} configs         - config of applications
   * @property {Array} configs.plugins  - list of plugins
   */
  configs={}
  constructor(configs){
    super();

    this.configs = configs;
    setTimeout(this.start.bind(this), 100)
  }

  async initialize() {
    this._initializePlugin(this.configs.plugins);
  }

  _initializePlugin(plugins) {
    for (let pluginName in plugins) {
      let [plugin, configs] = plugins[pluginName]
      this._plugins[pluginName] = new plugin(this, configs)
      this._plugins[pluginName].onInit();
    }
    // console.log('plugins initialized.')
  }

  async __onData(data){
    return await this.emit('data', data)
  }

  async start(){
      while (true) {
        try {
          let [queue, dataStr] = await blpopAsync(MUON_APPLICATION_QUEUE_REQUEST, 0)
          let data = JSON.parse(dataStr);
          if (data) {
            let response = await this.__onData(data)
            // responseRedis

            responseRedis.publish(MUON_APPLICATION_QUEUE_RESPONSE, JSON.stringify({
              responseId: callId,
              response,
            }))
          }
        } catch (e) {
          console.error(e)
        }
      }
  }
}

async function start() {
  let apps = new Application({
    plugins: []
  });

  await apps.initialize()
  apps.start()
}

module.exports = {
  start
}


