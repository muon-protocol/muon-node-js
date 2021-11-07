const CallablePlugin = require('./base/callable-plugin')
const {remoteMethod, gatewayMethod, broadcastMethod} = require('./base/app-decorators')
const {timeout} = require('../utils/helpers')

const RemoteMethods = {
  WhoIsTssReadyResponse: "WhoIsTssReadyResponse"
}

const BroadcastMethods = {
  WhoIsTssReady: "WhoIsTssReady"
}

class NetworkStatusPlugin extends CallablePlugin {
  _walletPeerId = {}

  async onStart() {
    super.onStart();

    // this.muon.getPlugin('collateral').on('loaded', this.tick.bind(this))
  }

  get tssPlugin() {
    return this.muon.getPlugin('tss-plugin');
  }

  get RemoteCall() {
    return this.muon.getPlugin('remote-call');
  }

  async tick() {
    if(!this.tssPlugin.isReady) {
      console.log('================================ tick ================================')
      this.broadcastToMethod(BroadcastMethods.WhoIsTssReady, {peerId: process.env.PEER_ID})
    }

    setTimeout(this.tick.bind(this), 5000)
  }

  @broadcastMethod(BroadcastMethods.WhoIsTssReady, {allowFromOtherGroups: true})
  async __whoIsTssReady(data={}, callerInfo) {
    let {peerId} = data;
    if(!peerId || !this.tssPlugin.isReady)
      return;
    let peer = await this.findPeer(peerId)
    await this.remoteCall(peer, RemoteMethods.WhoIsTssReadyResponse)
  }

  @remoteMethod(RemoteMethods.WhoIsTssReadyResponse, {allowFromOtherGroups: true})
  async _onTssReadyNodeResponse(data={}, callerInfo) {
    console.log("NetworkStatusPlugin_onTssReadyNodeResponse", {data, caller: callerInfo.wallet})
  }

  @gatewayMethod('status')
  async __getStatus() {
    let tssReady = this.tssPlugin.isReady;
    return {
      tssReady,
      group: this.tssPlugin.GroupAddress,
    }
  }

  @gatewayMethod('forward-request')
  async __forwardRequest(data={}) {
    return {...data, message: "forward-request"}
  }
}

module.exports = NetworkStatusPlugin;
