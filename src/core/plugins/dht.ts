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

type DHTReqData = Override<GatewayCallData, {params: { key: string, data?: string }}>


@remoteApp
class DHT extends CallablePlugin {
  APP_NAME="dht"

  @gatewayMethod("put")
  async __onPut(req: DHTReqData){
    let {key, data={}} = req?.params || {}
    await NetworkIpc.putDHT(`/muon/${key}`, data);
    return {success: true}
  }

  @gatewayMethod("get")
  async __onGet(req: DHTReqData) {
    let {key} = req?.params || {}
    let val = await NetworkIpc.getDHT(`/muon/${key}`);
    return {data: val}
  }
}

export default DHT;