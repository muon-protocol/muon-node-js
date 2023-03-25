import CallablePlugin from './base/callable-plugin.js'
import Content from '../../common/db-models/Content.js'
import {remoteApp, remoteMethod, gatewayMethod, globalBroadcastHandler, broadcastHandler} from './base/app-decorators.js'
import TssPlugin from "./tss-plugin.js";
import {AppDeploymentStatus, MuonNodeInfo, Override} from "../../common/types";
import HealthCheck from "./health-check.js";
import {GatewayCallParams} from "../../gateway/types";
import AppManager from "./app-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import {GlobalBroadcastChannels} from "../../common/contantes.js";
import CollateralInfoPlugin from "./collateral-info.js";
import {timeout} from '../../utils/helpers.js'
import {RedisCache} from "../../common/redis-cache.js";
import BaseAppPlugin from "./base/base-app-plugin";

const requestConfirmCache: RedisCache = new RedisCache('req-confirm')

type GetNodeInfo = Override<GatewayCallParams, {params: {id: string}}>

type GetTransactionData = Override<GatewayCallParams, {params: { reqId: string }}>

type CheckReqData = Override<GatewayCallParams, {params: {request: object}}>

type LastTransactionData = Override<GatewayCallParams, {params: { count?: number }}>

type GetAppData = Override<GatewayCallParams, {params: { appName?: string, appId?: string }}>

const RemoteMethods = {
  IsReqConfirmationAnnounced: "is-req-conf-ann",
  AppDeploymentStatus: "app-deployment-status",
  LoadAppContextAndKey: "load-app-context",
}

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

  /**
   * For all nodes in announce list of app, this function confirms that app.onConfirm has been called on this node.
   */
  @gatewayMethod('req-check')
  async __checkRequest(data: CheckReqData) {
    const {request} = data?.params || {};
    if(!request)
      throw `request undefined`
    // @ts-ignore
    const appParty = this.tssPlugin.getAppParty(request.appId)
    if(!appParty)
      throw `App party not found`;

    // @ts-ignore
    const {appId, reqId} = request;
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    let isValid = await app.verifyCompletedRequest(request, false)
    if(!isValid)
      throw `request validation failed.`

    const announceList = {}, hasAnnouncement = !!app.onConfirm;
    if(hasAnnouncement){
      announceList['primary'] = appParty.partners
      if(!!app.getConfirmAnnounceList) {
        announceList['secondary'] = await app.getConfirmAnnounceList(request)
      }
    }

    const nodesToAnnounceConfirmation = this.collateralPlugin.filterNodes({
      list: [
        ...announceList['primary'],
        ...(announceList['secondary']||[]),
        ]
    });
    const announced: boolean[] = await Promise.all(nodesToAnnounceConfirmation.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__isReqConfirmationAnnounced(reqId, this.collateralPlugin.currentNodeInfo);
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.IsReqConfirmationAnnounced,
          reqId
        )
          .catch(e => false)
      }
    }))

    return {
      isValid,
      tss: {
        t: appParty.t,
        n: appParty.max
      },
      hasAnnouncement,
      announceList,
      announced: announced.reduce((obj, check, index) => {
        let group = index < announceList['primary'].length ? 'primary' : 'secondary'
        obj[group][nodesToAnnounceConfirmation[index].id] = check
        return obj
      }, {primary: {}, secondary: {}})
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

    const statusTitle = ["NEW", "TSS_GROUP_SELECTED", "DEPLOYED"][statusCode];

    let partnersStatus;
    if(context && statusCode > 0) {
      const partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
        list: context.party.partners
      })
      const responses = await Promise.all(
        partners.map(n => {
          if(n.wallet === process.env.SIGN_WALLET_ADDRESS)
            return this.__getAppDeploymentStatus(appId, this.collateralPlugin.currentNodeInfo!)
          return this.remoteCall(
            n.peerId,
            RemoteMethods.AppDeploymentStatus,
            appId,
            {timeout: 5000}
          )
            .catch(e => null)
        })
      )
      partnersStatus = responses.reduce((obj, result, index) => {
        const node = partners[index]
        obj[node.id] = result

        /** call remote node to load app context*/
        this.remoteCall(
          node.peerId,
          RemoteMethods.LoadAppContextAndKey,
          appId
        )
          .catch(e => {})

        return obj
      }, {})
    }

    return {
      appId,
      appName,
      status: statusTitle,
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
      },
      partnersStatus: partnersStatus,
    }
  }

  @remoteMethod(RemoteMethods.IsReqConfirmationAnnounced)
  async __isReqConfirmationAnnounced(reqId: string, callerInfo) {
    let confirmed: string = await requestConfirmCache.get(reqId)
    return confirmed === '1'
  }

  @remoteMethod(RemoteMethods.AppDeploymentStatus)
  async __getAppDeploymentStatus(appId, callerInfo: MuonNodeInfo) {
    return this.appManager.getAppDeploymentStatus(appId)
  }

  @remoteMethod(RemoteMethods.LoadAppContextAndKey)
  async __loadAppContextAndKey(appId, callerInfo: MuonNodeInfo) {
    if(!callerInfo.isDeployer)
      return;
    const status:AppDeploymentStatus = this.appManager.getAppDeploymentStatus(appId)
    let context;
    if(status === 'NEW') {
      context = await this.appManager.queryAndLoadAppContext(appId);
      if(!context || !context.party.partners.includes(this.collateralPlugin.currentNodeInfo!.id))
        return;
    }
    if(status !== 'DEPLOYED') {
      await timeout(2000)
      await this.tssPlugin.checkAppTssKeyRecovery(appId);
    }
  }
}

export default Explorer;
