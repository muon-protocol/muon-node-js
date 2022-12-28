import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators'
import TssPlugin from "./tss-plugin";
import * as NetworkIpc from '../../network/ipc'
import {MuonNodeInfo} from "../../common/types";
const {timeout} = require('../../utils/helpers')
const OS = require('os')
const util = require('util');
const shellExec = util.promisify(require('child_process').exec);


const RemoteMethods = {
  CheckHealth: 'check-health',
}

@remoteApp
class HealthCheck extends CallablePlugin {
  APP_NAME="health"
  healthCheckEndpoint: string;
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

  private async collectNodeStatus(){
    const {stdout: uptimeStdOut, stderr: uptimeStdErr} = await shellExec('uptime');
    const {stdout: freeStdOut, stderr: freeStdErr} = await shellExec('free');

    const freeCols = freeStdOut.split("\n")[1].split(' ').filter(i => !!i)
    return {
      numCpus: OS.cpus().length,
      loadAvg: uptimeStdOut.split('load average')[1].substr(2).trim(),
      memory: `${freeCols[6]}/${freeCols[1]}`,
      uptime: await NetworkIpc.getUptime(),
    }
  }

  async getNodeStatus(node?: MuonNodeInfo) {
    if(!node)
      return await this.collectNodeStatus()

    return await this.remoteCall(
      node.peerId,
      RemoteMethods.CheckHealth,
      {log: true}
    )
  }

  @remoteMethod(RemoteMethods.CheckHealth)
  async _onHealthCheck(data:{log?: any}={}) {
    if(data?.log)
      console.log(`===== HealthCheck._onHealthCheck =====`, new Date());
    return {
      status: "OK",
      ... await this.collectNodeStatus()
    }
  }
}

export default HealthCheck;
