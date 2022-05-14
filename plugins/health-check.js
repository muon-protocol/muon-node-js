const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')
const {timeout} = require('../utils/helpers')

const RemoteMethods = {
  CheckHealth: 'check-health',
}

@remoteApp
class HealthCheck extends CallablePlugin {

  healthCheckEndpoint = null;
  checkingTime = {}

  async onStart() {
    this.healthCheckEndpoint = this.remoteMethodEndpoint(RemoteMethods.CheckHealth)
    this.muon.getPlugin('remote-call').on('error', this.onRemoteCallFailed.bind(this))
  }

  async onRemoteCallFailed({peerId, method, onRemoteSide=false}) {
    // TODO: need more check
    if(method === this.healthCheckEndpoint || onRemoteSide)
      return;
    let peerIdStr = peerId.toB58String()
    if(this.checkingTime[peerIdStr] && Date.now() - this.checkingTime[peerIdStr] < 30000) {
      return;
    }

    console.log(`checking peer ${peerId.toB58String()} health ...`, {peer: peerIdStr, method, onRemoteSide})

    this.checkingTime[peerIdStr] = Date.now();

    let peer = await this.findPeer(peerId);
    if (!peer) {
      // TODO: what to do ?
      return;
    }
    for (let i = 0; i < 3; i++) {
      try {
        let response = await this.remoteCall(peer, RemoteMethods.CheckHealth, null, {silent: true})
        if (response === 'OK') {
          console.log(`peer responded OK.`)
          return;
        }
      }catch (e) {}
      await timeout(5000)
    }
    console.log(`peer not responding. trigger muon onDisconnect`);
    await this.muon.onPeerDisconnect({remotePeer: peerId})
  }

  @remoteMethod(RemoteMethods.CheckHealth)
  async _onHealthCheck() {
    return "OK"
  }
}

module.exports = HealthCheck;
