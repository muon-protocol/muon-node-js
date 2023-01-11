import CallablePlugin from './base/callable-plugin.js'
import Content from '../../common/db-models/Content.js'
import {remoteApp, remoteMethod, gatewayMethod, globalBroadcastHandler, broadcastHandler} from './base/app-decorators.js'
import TssPlugin from "./tss-plugin.js";
import {MuonNodeInfo, Override} from "../../common/types";
import HealthCheck from "./health-check.js";
import {GatewayCallData} from "../../gateway/types";
import AppManager from "./app-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import {GlobalBroadcastChannels} from "../../common/contantes.js";
import CollateralInfoPlugin from "./collateral-info.js";
import {timeout} from '../../utils/helpers.js'

import * as NetworkDHTPlugin from '../../network/plugins/network-dht.js'

@remoteApp
class DHT extends CallablePlugin {
  APP_NAME="dht"

  @gatewayMethod("put")
  async __onPut(data){
    let ret = await NetworkIpc.putDHT("/muon/hello", "world");
    return {success: true}
  }

  @gatewayMethod("get")
  async __onGet(data) {
    let val = await NetworkIpc.getDHT('/muon/hello');
    return {data: val}
  }
}

export default DHT;