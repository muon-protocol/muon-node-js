import CallablePlugin from './base/callable-plugin'
const Content = require('../../common/db-models/Content')
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators'
import TssPlugin from "./tss-plugin";
import {MuonNodeInfo, Override} from "../../common/types";
import HealthCheck from "./health-check";
import {GatewayCallData} from "../../gateway/types";
import AppManager from "./app-manager";
const {timeout} = require('../../utils/helpers')

type GetTransactionData = Override<GatewayCallData, {params: { reqId: string }}>

type LastTransactionData = Override<GatewayCallData, {params: { count?: number }}>

type GetAppData = Override<GatewayCallData, {params: { appName?: string, appId?: string }}>

@remoteApp
class Explorer extends CallablePlugin {
  APP_NAME="explorer"

  get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  get healthPlugin(): HealthCheck {
    return this.muon.getPlugin('health-check')
  }

  get appManager(): AppManager {
    return this.muon.getPlugin('app-manager')
  }

  @gatewayMethod("list-nodes")
  async __onListNodes(data){
    let tssPlugin: TssPlugin = this.muon.getPlugin('tss-plugin')

    if(tssPlugin.tssParty === null)
      throw `TSS module not loaded yet`

    if(!process.env.SIGN_WALLET_ADDRESS)
      throw `process.env.SIGN_WALLET_ADDRESS is not defined`

    // TODO: replace with onlinePartners
    let partners: MuonNodeInfo[] = Object.values(tssPlugin.tssParty.onlinePartners)
      .filter((op: MuonNodeInfo) => op.wallet !== process.env.SIGN_WALLET_ADDRESS)

    let result = {
      [process.env.SIGN_WALLET_ADDRESS]: {
        status: "CURRENT",
        ... await this.healthPlugin.getNodeStatus().catch(e => null)
      }
    }
    let responses = await Promise.all(partners.map(node => {
      return this.healthPlugin.getNodeStatus(node).catch(e => null)
    }))

    for(let i=0 ; i<responses.length ; i++){
      result[partners[i].wallet] = responses[i];
    }

    return result;
  }

  @gatewayMethod("tx")
  async __onTxInfo(data: GetTransactionData) {
    let content = await Content.findOne({reqId: data?.params?.reqId});
    if(content) {
      return JSON.parse(content.content);
    }
    else
      throw `Transaction not found`
  }

  @gatewayMethod('last-tx')
  async __onLastTx(data: LastTransactionData) {
    let {count=10} = data?.params || {}
    count = Math.min(count, 100)

    let contents = await Content.find({}, {reqId: 1, _id: 1}).sort({_id: -1}).limit(count);

    return contents.map(c => c.reqId);
  }

  @gatewayMethod('app')
  async __onGetAppInfo(data: GetAppData) {
    let {appName, appId} = data.params;
    if(!!appName) {
      appId = this.muon.getAppIdByName(appName)
    }
    else if(!appId)
      throw `App Name/ID required`

    const context = this.appManager.getAppContext(appId!)
    const tss = this.tssPlugin.getAppTssKey(appId!)

    return {
      appId,
      appName: context.appName,
      context: !context ? null : {
        isBuiltIn: context.isBuiltIn,
        version: context.version,
        deployedTime: context.deployedTime,
        deploySeed: context.seed,
      },
      tss: !context ? null : {
        threshold: {
          t: context.party.t,
          max: context.party.max
        },
        publicKey: !tss ? null : {
          address: tss.address,
          encoded: tss.publicKey?.encodeCompressed("hex"),
          x: tss.publicKey?.getX().toBuffer('be', 32).toString('hex'),
          yParity: tss.publicKey?.getY().isEven() ? 0 : 1
        },
      }
    }
  }
}

export default Explorer;
