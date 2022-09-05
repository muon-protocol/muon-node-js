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
    const key = await this.TssPlugin.keyGen()
    return {
      available: availableNodes,
      data: {params, callId},
      key: key.address
    }
  }
}

export default SystemApp
