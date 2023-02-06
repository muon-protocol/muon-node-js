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

type GetNodeInfo = Override<GatewayCallData, {params: {id: string}}>

type GetTransactionData = Override<GatewayCallData, {params: { reqId: string }}>

type LastTransactionData = Override<GatewayCallData, {params: { count?: number }}>

type GetAppData = Override<GatewayCallData, {params: { appName?: string, appId?: string }}>

@remoteApp
class Explorer extends CallablePlugin {
  APP_NAME="explorer"

  get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  get healthPlugin(): HealthCheck {
    return this.muon.getPlugin('health-check')
  }

  get appManager(): AppManager {
    return this.muon.getPlugin('app-manager')
  }

  @gatewayMethod("list-nodes")
  async __onListNodes(data){
    if(!process.env.SIGN_WALLET_ADDRESS)
      throw `process.env.SIGN_WALLET_ADDRESS is not defined`

    await this.collateralPlugin.waitToLoad();

    // TODO: replace with onlinePartners
    // TODO: this returns only deployer nodes
    let partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      isOnline: true,
      excludeSelf: true
    })

    let currentNode = this.collateralPlugin.currentNodeInfo!;

    let result = {
      [currentNode?.id || 'current']: {
        status: "CURRENT",
        ... await this.healthPlugin.getNodeStatus().catch(e => null)
      }
    }
    let responses = await Promise.all(partners.map(node => {
      return this.healthPlugin.getNodeStatus(node).catch(e => null)
    }))

    for(let i=0 ; i<responses.length ; i++){
      if(responses[i] !== null)
        result[partners[i].id] = responses[i];
    }

    return result;
  }

  @gatewayMethod("node")
  async __nodeInfo(data: GetNodeInfo) {
    let {id} = data?.params || {}
    if(!id) {
      throw `id is undefined`
    }
    let nodeInfo = this.collateralPlugin.getNodeInfo(id)!
    if(!nodeInfo) {
      throw `unknown peer`
    }
    return {
      peerInfo: await NetworkIpc.getPeerInfo(nodeInfo.peerId),
      nodeInfo: await this.healthPlugin.getNodeStatus(nodeInfo).catch(e => e.message)
    }
  }

  @gatewayMethod("node-peer")
  async __nodePeerInfo(data: GetNodeInfo) {
    let {id} = data?.params || {}
    if(!id) {
      throw `id is undefined`
    }
    let nodeInfo = this.collateralPlugin.getNodeInfo(id)!
    if(!nodeInfo) {
      throw `unknown peer`
    }
    return {
      peerInfo: await NetworkIpc.getPeerInfoLight(nodeInfo.peerId)
    }
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

    if(appId === '0')
      throw `App not found`;

    let context = this.appManager.getAppContext(appId!)
    if(!context)
      context = await this.appManager.queryAndLoadAppContext(appId!)

    let statusCode = 0
    if(!!context)
      statusCode ++;
    if(!!context?.publicKey?.address)
      statusCode ++;

    return {
      appId,
      appName,
      status: ["NEW","TSS_GROUP_SELECTED", "DEPLOYED"][statusCode],
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
        publicKey: context.publicKey || null
      }
    }
  }
}

export default Explorer;
