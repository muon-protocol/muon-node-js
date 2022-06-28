const CallablePlugin = require('./base/callable-plugin')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')
const {timeout} = require('../utils/helpers')
const OS = require('os')
const util = require('util');
const shellExec = util.promisify(require('child_process').exec);


const RemoteMethods = {
  CheckHealth: 'check-health',
}

@remoteApp
class HealthCheck extends CallablePlugin {
  APP_NAME="health"
  healthCheckEndpoint = null;
  checkingTime = {}

  async onStart() {
    this.healthCheckEndpoint = this.remoteMethodEndpoint(RemoteMethods.CheckHealth)
    // this.muon.getPlugin('remote-call').on('error', this.onRemoteCallFailed.bind(this))
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
        if (response?.status === 'OK') {
          console.log(`peer responded OK.`)
          return;
        }
      }catch (e) {}
      await timeout(5000)
    }
    console.log(`peer not responding. trigger muon onDisconnect`);
    await this.muon.onPeerDisconnect({remotePeer: peerId})
  }

  async getNodeStatus(){
    const {stdout: uptimeStdOut, stderr: uptimeStdErr} = await shellExec('uptime');
    const {stdout: freeStdOut, stderr: freeStdErr} = await shellExec('free');

    const freeCols = freeStdOut.split("\n")[1].split(' ').filter(i => !!i)
    return {
      numCpus: OS.cpus().length,
      loadAvg: uptimeStdOut.split('load average')[1].substr(2).trim(),
      memory: `${freeCols[6]}/${freeCols[1]}`
    }
  }

  @gatewayMethod("list-nodes")
  async _onListNodes(data){
    let tssPlugin = this.muon.getPlugin('tss-plugin')

    let partners = Object.values(tssPlugin.tssParty.partners)
      .filter(({peer, wallet}) => (!!peer && wallet !== process.env.SIGN_WALLET_ADDRESS))

    let result = {
      [process.env.SIGN_WALLET_ADDRESS]: {
        status: "CURRENT",
        ... await this.getNodeStatus()
      }
    }

    const peerList = partners.map(({peer}) => peer)

    let calls = peerList.map(peer => {
      return this.remoteCall(peer, RemoteMethods.CheckHealth, {log: true})
        .catch(e => null)
    });
    let responses = await Promise.all(calls)

    for(let i=0 ; i<responses.length ; i++){
      result[partners[i].wallet] = responses[i];
    }

    return result;
  }

  @remoteMethod(RemoteMethods.CheckHealth)
  async _onHealthCheck(data={}) {
    if(data?.log)
      console.log(`===== HealthCheck._onHealthCheck =====`, new Date());
    return {
      status: "OK",
      ... await this.getNodeStatus()
    }
  }
}

module.exports = HealthCheck;
