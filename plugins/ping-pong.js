const BasePlugin = require('./base-plugin')
const {timeout} = require('../utils/helpers')

class PingPong extends BasePlugin {

  async ping(data){
    // console.log('DataExchange.onRemotePing', data)
    // await timeout(2000 + Math.floor(Math.random() * 3000));
    return 'Pong'
  }

  async onStart() {
    this.muon.getPlugin('remote-call').on('remote:ping', this.ping)
  }
}

module.exports = PingPong;
