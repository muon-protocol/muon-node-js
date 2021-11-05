const CallablePlugin = require('./base/callable-plugin')
const {remoteMethod} = require('./base/app-decorators')

class PingPong extends CallablePlugin {
  @remoteMethod('ping')
  async ping(data){
    return 'Pong'
  }
}

module.exports = PingPong;
