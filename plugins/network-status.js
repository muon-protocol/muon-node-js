const CallablePlugin = require('./base/callable-plugin')
const { gatewayMethod } = require('./base/app-decorators')

class NetworkStatusPlugin extends CallablePlugin {

  get tssPlugin() {
    return this.muon.getPlugin('tss-plugin');
  }

  @gatewayMethod('status')
  async __getStatus() {
    let tssReady = this.tssPlugin.isReady;
    return {
      tssReady,
      group: this.tssPlugin.GroupAddress,
    }
  }
}

module.exports = NetworkStatusPlugin;
