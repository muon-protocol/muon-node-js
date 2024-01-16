import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, gatewayMethod} from './base/app-decorators.js'
import {Override} from "../../common/types";
import {GatewayCallParams} from "../../gateway/types";
import * as NetworkIpc from '../../network/ipc.js'

type DHTReqData = Override<GatewayCallParams, {params: { key: string, data?: string }}>


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
