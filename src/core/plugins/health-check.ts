import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators.js'
import KeyManager from "./key-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import {MuonNodeInfo} from "../../common/types";
import {timeout} from '../../utils/helpers.js'
import OS from 'os'
import {peerId2Str} from "../../network/utils.js";
import {getStatusData} from "../../gateway/status.js"


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
  }

  private async collectNodeStatus(){
    const loadAvg = OS.loadavg().map(load => Math.round(load * 100) / 100).toString();
    const freeMem = OS.freemem() / 1024;
    const totalMem = OS.totalmem() / 1024;

    return {
      numCpus: OS.cpus().length,
      loadAvg,
      memory: `${freeMem}/${totalMem}`,
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
  async _onHealthCheck() {
    return {
      status: "OK",
      statusData: await getStatusData({}),
      ... await this.collectNodeStatus()
    }
  }
}

export default HealthCheck;

