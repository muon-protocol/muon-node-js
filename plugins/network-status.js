const CallablePlugin = require('./base/callable-plugin')
const {remoteMethod, gatewayMethod} = require('./base/app-decorators')

const RemoteMethods = {
  HelloWorld: "hello-broadcast-method"
}

class NetworkStatusPlugin extends CallablePlugin {

  async onStart() {
    super.onStart();

    this.muon.getPlugin('group-leader').once('leader-change', this.tick.bind(this))
  }

  get TssPlugin() {
    return this.muon.getPlugin('tss-plugin');
  }

  async tick() {
  }

  async onBroadcastReceived(msg={}, callerInfo) {
    let {method, params} = msg
    console.log({method, params})
  }

  @remoteMethod(RemoteMethods.HelloWorld, {allowFromOtherGroups: true})
  async __firstBroadcastMethodEver(data={}, callerInfo) {
    console.log('$$$$$$$$$$$$$$ Congratulation! you did it. $$$$$$$$$$$$', {data, callerInfo})
  }

  @gatewayMethod('status')
  async __getStatus() {
    let tssReady = this.TssPlugin.isReady;
    return {
      tssReady,
      group: this.TssPlugin.GroupAddress,
    }
  }

  @gatewayMethod('test')
  async __test() {
    this.broadcastToMethod(RemoteMethods.HelloWorld, {id: 'list'})
    return this.BROADCAST_CHANNEL;
  }

  @gatewayMethod('forward-request')
  async __forwardRequest(data={}) {
    return {...data, message: "forward-request"}
  }

  @remoteMethod('test', {allowFromOtherGroups: true})
  async __TestRemoteMethod(data={}, callerInfo) {
    console.log('NetworkStatus.__TestRemoteMethod', data);
    return true;
  }
}

module.exports = NetworkStatusPlugin;
