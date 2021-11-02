const BasePlugin = require('./base/base-plugin')

const Status = {
  Init: 'Init',
};

class NetworkStatusPlugin extends BasePlugin {

  updateStatus(status) {
    this.broadcast({status, peerId: process.env.PEER_ID});
  }

  get Status() { return Status; }

  async onBroadcastReceived(data, callerInfo) {
    // console.log('NetworkStatusPlugin.onBroadcastReceived', {data, callerInfo})
    // try {
    // } catch (e) {
    //   console.error(e)
    // }
  }
}

module.exports = NetworkStatusPlugin;
