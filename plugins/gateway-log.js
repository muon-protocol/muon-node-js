const BasePlugin = require('./base/base-plugin')

class GatewayLog extends BasePlugin {

  async onData(data){
    console.log('Data from gateway: ', data)
  }

  async onStart() {
    this.muon.getPlugin('gateway-interface').on('data', this.onData)
  }
}

module.exports = GatewayLog;
