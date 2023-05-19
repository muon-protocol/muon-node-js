import CallablePlugin from './base/callable-plugin.js'
import Content from '../../common/db-models/Content.js'
import {remoteApp, remoteMethod, gatewayMethod, globalBroadcastHandler, broadcastHandler} from './base/app-decorators.js'
import TssPlugin from "./tss-plugin.js";
import {AppContext, AppDeploymentStatus, MuonNodeInfo, Override} from "../../common/types";
import HealthCheck from "./health-check.js";
import {GatewayCallParams} from "../../gateway/types";
import AppManager from "./app-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import {GlobalBroadcastChannels} from "../../common/contantes.js";
import NodeManagerPlugin from "./node-manager.js";
import {timeout} from '../../utils/helpers.js'
import {RedisCache} from "../../common/redis-cache.js";
import BaseAppPlugin from "./base/base-app-plugin";
import {MapOf} from "../../common/mpc/types";

const requestConfirmCache: RedisCache = new RedisCache('req-confirm')

type GetNodeInfo = Override<GatewayCallParams, {params: {id: string}}>

type GetTransactionData = Override<GatewayCallParams, {params: { reqId: string }}>

type CheckReqData = Override<GatewayCallParams, {params: {request: object}}>

type LastTransactionData = Override<GatewayCallParams, {params: { count?: number }}>

type GetAppData = Override<GatewayCallParams, {params: { appName?: string, appId?: string, seed?:string }}>

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

  get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  get healthPlugin(): HealthCheck {
    return this.muon.getPlugin('health-check')
  }

  get appManager(): AppManager {
    return this.muon.getPlugin('app-manager')
  }

  @gatewayMethod("node")
  async __nodeInfo(data: GetNodeInfo) {
    let {id} = data?.params || {}
    if(!id) {
      throw `id is undefined`
    }
    let nodeInfo = this.nodeManager.getNodeInfo(id)!
    if(!nodeInfo) {
      throw `unknown peer`
    }
    const startTime = Date.now();
    const [peerInfo, nodeStatus] = await Promise.all([
      NetworkIpc.getPeerInfo(nodeInfo.peerId)
        .catch(e => e.message),
      this.healthPlugin.getNodeStatus(nodeInfo)
        .catch(e => e.message)
    ])
    return {
      peerInfo,
      nodeInfo: nodeStatus,
      execTime: Date.now() - startTime,
    }
  }

  @gatewayMethod("test")
  async __test(data) {
    let {appId, seed} = data?.params || {}
    const nodes = ["1", "2","3","4","5","6","7","8","9","10"]
    return this.appManager.findNAvailablePartners(nodes, 3, {appId, seed})
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
    const appParty = this.tssPlugin.getAppParty(request.appId, request.deploymentSeed)
    if(!appParty)
      throw `App party not found`;

    // @ts-ignore
    const {appId, reqId} = request;
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    let isValid = await app.verifyCompletedRequest(request, false)
    if(!isValid)
      throw `request validation failed.`

    const announceGroups: string[][] = [], hasAnnouncement = !!app.onConfirm;
    if(hasAnnouncement){
      announceGroups.push(appParty.partners)
      if(!!app.getConfirmAnnounceGroups) {
        const moreAnnounceGroups = await app.getConfirmAnnounceGroups(request)
        moreAnnounceGroups.forEach(group => announceGroups.push(group))
      }
    }

    const listToCheck = ([] as string[]).concat(...announceGroups);

    const partners = this.nodeManager.filterNodes({list: listToCheck});
    const announced: boolean[] = await Promise.all(partners.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__isReqConfirmationAnnounced(reqId, this.nodeManager.currentNodeInfo);
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
    const announceMap: MapOf<boolean> = partners.reduce((obj, {id}, i) => (obj[id]=announced[i], obj), {})

    const groupsAnnouncedPartners = announceGroups.map(group => {
      return group.map(id => announceMap[id])
        .filter(announced => announced)
    })

    const groupAnnounced: boolean[] = groupsAnnouncedPartners
      .map(g => {
        /** The group has reached or exceeded the threshold of announced partners ? */
        return g.filter(a => a).length >= appParty.t
      })

    return {
      isValid,
      tss: {
        t: appParty.t,
        n: appParty.max
      },
      hasAnnouncement,
      /** The first group is the app party, and the following groups are the ones that the app returns. */
      appPartyAnnounced: groupAnnounced[0],
      allGroupsAnnounced: announceGroups.length === groupAnnounced.filter(a => a).length,
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
    let {appName, appId, seed} = data.params;
    if(!!appName) {
      appId = this.muon.getAppIdByName(appName)
    }
    else if(!appId)
      throw `App Name/ID required`

    if(appId === '0')
      throw `App not found`;

    let contexts: AppContext[] = this.appManager.getAppAllContext(appId!, true)
    if(contexts.length === 0)
      contexts = await this.appManager.queryAndLoadAppContext(appId!)

    const contextStatuses = contexts.map((context: AppContext) => {
      const statusTitle = this.appManager.getAppDeploymentStatus(appId!, context.seed);
      return {
        status: statusTitle,
        isBuiltIn: context.isBuiltIn,
        deployedTime: context.deploymentRequest?.data.timestamp,
        previousSeed: context.previousSeed,
        seed: context.seed,
        tss: !context ? null : {
          threshold: {
            t: context.party?.t,
            max: context.party?.max
          },
          publicKey: context.publicKey || null,
        },
      }
    })

    let appStatus = "NEW";
    if(contextStatuses.length > 0) {
      const context = this.appManager.getAppLastContext(appId);
      appStatus = this.appManager.getAppDeploymentStatus(appId, context.seed);
    }

    return {
      appId,
      appName,
      status: appStatus,
      contexts: contextStatuses,
    }
  }

  @remoteMethod(RemoteMethods.IsReqConfirmationAnnounced)
  async __isReqConfirmationAnnounced(reqId: string, callerInfo) {
    let confirmed: string = await requestConfirmCache.get(reqId)
    return confirmed === '1'
  }

  @remoteMethod(RemoteMethods.AppDeploymentStatus)
  async __getAppDeploymentStatus(data: {appId: string, seed: string}, callerInfo: MuonNodeInfo) {
    const {appId, seed} = data
    return this.appManager.getAppDeploymentStatus(appId, seed)
  }

  @remoteMethod(RemoteMethods.LoadAppContextAndKey)
  async __loadAppContextAndKey(data: {appId:string, seed: string}, callerInfo: MuonNodeInfo) {
    const {appId, seed} = data
    if(!callerInfo.isDeployer && callerInfo.wallet !== process.env.SIGN_WALLET_ADDRESS)
      return;
    const status:AppDeploymentStatus = this.appManager.getAppDeploymentStatus(appId, seed)
    let contexts: AppContext[];
    if(status === 'NEW') {
      contexts = await this.appManager.queryAndLoadAppContext(appId);
      if(contexts.length===0)
        return;
      const ctx = contexts.find(ctx => ctx.seed === seed);
      if(!ctx || !ctx.party.partners.includes(this.nodeManager.currentNodeInfo!.id))
        return;
    }
    if(status !== 'DEPLOYED') {
      await timeout(2000)
      await this.tssPlugin.checkAppTssKeyRecovery(appId, seed);
    }
  }
}

export default Explorer;
