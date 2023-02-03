import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators.js'
import TssPlugin from "./tss-plugin.js";
import * as NetworkIpc from '../../network/ipc.js'
import {MuonNodeInfo} from "../../common/types";
import {timeout} from '../../utils/helpers.js'
import OS from 'os'
import util from 'util'
import ChildProcess from 'child_process'
import {peerId2Str} from "../../network/utils.js";

const shellExec = util.promisify(ChildProcess.exec);

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

  // async onRemoteCallFailed({peerId, method, onRemoteSide=false}) {
  //   // TODO: need more check
  //   if(method === this.healthCheckEndpoint || onRemoteSide)
  //     return;
  //   let peerIdStr = peerId2Str(peerId)
  //   if(this.checkingTime[peerIdStr] && Date.now() - this.checkingTime[peerIdStr] < 30000) {
  //     return;
  //   }
  //
  //   console.log(`checking peer ${peerId2Str(peerId)} health ...`, {peer: peerIdStr, method, onRemoteSide})
  //
  //   this.checkingTime[peerIdStr] = Date.now();
  //
  //   // @ts-ignore
  //   let peer = await this.findPeer(peerId);
  //   if (!peer) {
  //     // TODO: what to do ?
  //     return;
  //   }
  //   for (let i = 0; i < 3; i++) {
  //     try {
  //       let response = await this.remoteCall(peer, RemoteMethods.CheckHealth, null, {silent: true})
  //       if (response?.status === 'OK') {
  //         console.log(`peer responded OK.`)
  //         return;
  //       }
  //     }catch (e) {}
  //     await timeout(5000)
  //   }
  //   console.log(`peer not responding. trigger muon onDisconnect`)
  //   // @ts-ignore;
  //   await this.muon.onPeerDisconnect({remotePeer: peerId})
  // }

  private async collectNodeStatus(){
    const {stdout: uptimeStdOut, stderr: uptimeStdErr} = await shellExec('uptime');
    const {stdout: freeStdOut, stderr: freeStdErr} = await shellExec('free');

    const freeCols = freeStdOut.split("\n")[1].split(' ').filter(i => !!i)
    return {
      numCpus: OS.cpus().length,
      loadAvg: uptimeStdOut.split('load average')[1].substr(2).trim(),
      memory: `${freeCols[6]}/${freeCols[1]}`,
      uptime: await NetworkIpc.getUptime(),
      networkingPort: process.env.PEER_PORT,
      gatewayPort: process.env.GATEWAY_PORT
    }
  }

  async getNodeStatus(node?: MuonNodeInfo) {
    if(!node)
      return await this.collectNodeStatus()

    return await this.remoteCall(
      node.peerId,
      RemoteMethods.CheckHealth,
      {log: true},
      {timeout: 5000}
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
