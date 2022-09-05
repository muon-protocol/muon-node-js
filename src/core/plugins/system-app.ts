import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";

@remoteApp
class SystemApp extends CallablePlugin {
  APP_NAME = 'system'

  get CollateralPlugin(): CollateralInfoPlugin{
    return this.muon.getPlugin('collateral-info');
  }

  get TssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');
  }

  @gatewayMethod('deploy')
  async __deployApp({params, callId}) {
    const availableNodes = this.TssPlugin.tssParty!.onlinePartners
    if(Object.keys(availableNodes).length < this.CollateralPlugin.TssThreshold)
      throw "No enough partners to deploy app"
    const key = await this.TssPlugin.keyGen(null, {maxPartners: Object.keys(availableNodes).length})
    return {
      available: availableNodes,
      data: {params, callId},
      key: key.address
    }
  }
}

export default SystemApp
