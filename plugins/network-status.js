const CallablePlugin = require('./base/callable-plugin')
const {remoteMethod, gatewayMethod, broadcastMethod} = require('./base/app-decorators')
const TimeoutPromise = require('../core/timeout-promise')
const {timeout} = require('../utils/helpers')

const RemoteMethods = {
  TssReadyResponse: "TssReadyResponse",
  ForwardRequest: "ForwardRequest",
}

const BroadcastMethods = {
  WhoIsTssReady: "WhoIsTssReady"
}

class NetworkStatusPlugin extends CallablePlugin {
  // TODO: Detect adversary behavior.

  _searchPromise = null;

  async onStart() {
    super.onStart();

    // this.muon.getPlugin('collateral').on('loaded', this.tick.bind(this))
  }

  get tssPlugin() {
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin() {
    return this.muon.getPlugin('collateral')
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
    let {wallet} = callerInfo;
    /**
     * only response when tss is ready
     */
    if(!peerId || !this.tssPlugin.isReady)
      return;
    /**
     * search for other groups
     */
    if(!this.collateralPlugin.otherGroupWallets[wallet]) {
      return;
    }

    let peer = await this.findPeer(peerId);
    await this.remoteCall(peer, RemoteMethods.TssReadyResponse)
  }

  @remoteMethod(RemoteMethods.TssReadyResponse, {allowFromOtherGroups: true})
  async _onTssReadyNodeResponse(data={}, callerInfo) {
    // console.log("NetworkStatusPlugin_onTssReadyNodeResponse", {data, caller: callerInfo.wallet})
    let {wallet, peerId} = callerInfo
    if(this.collateralPlugin.otherGroupWallets[wallet]){
      // this._walletPeerId[wallet] = peerId;
      if(this._searchPromise){
        // console.log('forward search found', {wallet, peerId: peerId.toB58String()})
        this._searchPromise.resolve({wallet, peerId})
      }
    }
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
    if(!this._searchPromise){
      console.log('initializing forward search ...')
      this._searchPromise = new TimeoutPromise(10000, "Search for forward node timed out.", {resolveOnTimeout: true})
      this.broadcastToMethod(BroadcastMethods.WhoIsTssReady, {peerId: process.env.PEER_ID})
    }
    let forwardNode = await this._searchPromise.waitToFulfill();
    /**
     * When request timed out and forward node not found
     */
    if(!forwardNode){
      /**
       * clear search for next time.
       */
      this._searchPromise = null;
      /**
       * throw timeout response
       */
      throw {message: "Search for forward node timed out."}
    }

    let {wallet, peerId} = forwardNode;
    if(!peerId)
      throw {message: "Node not found to forward request"}

    let remotePeer = await this.findPeer(peerId);
    console.log(`forwarding request to node: [${wallet}]@[${peerId.toB58String()}]...`)
    try {
      let response = await this.remoteCall(remotePeer, RemoteMethods.ForwardRequest, data)
      return response;
    }catch (e) {
      /**
       * Clear search result for next times.
       */
      this._searchPromise = null;
      throw e;
    }
  }

  @remoteMethod(RemoteMethods.ForwardRequest, {allowFromOtherGroups: true})
  async __onForwardRequestArrive(data={}, callerInfo) {
    let {app, method, params, nSign} = data;
    console.log('response to forwarded request', data);
    if(!app)
      throw {message: "invalid app."}
    let response = await this.muon.getPlugin('gateway-interface').call(app, method, params, nSign);
    return response
  }
}

module.exports = NetworkStatusPlugin;
