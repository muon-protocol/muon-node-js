import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators.js'
import KeyManager from "./key-manager.js";
import {AppContext, AppDeploymentStatus, AppRequest, MuonNodeInfo, Override} from "../../common/types";
import HealthCheck from "./health-check.js";
import {GatewayCallParams} from "../../gateway/types";
import AppManager from "./app-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import NodeManagerPlugin from "./node-manager.js";
import {RedisCache} from "../../common/redis-cache.js";
import BaseAppPlugin from "./base/base-app-plugin";
import {MapOf} from "../../common/mpc/types";
import {APP_STATUS_DEPLOYED, APP_STATUS_EXPIRED, APP_STATUS_ONBOARDING, APP_STATUS_PENDING} from "../constants.js";
import {GENESIS_SEED} from "../../common/contantes.js";

const requestConfirmCache: RedisCache = new RedisCache('req-confirm')

type GetNodeInfo = Override<GatewayCallParams, {params: {id: string}}>

type GetTransactionData = Override<GatewayCallParams, {params: { reqId: string }}>

type CheckReqData = Override<GatewayCallParams, {params: {request: object}}>

type LastTransactionData = Override<GatewayCallParams, {params: { count?: number }}>

type GetAppData = Override<GatewayCallParams, {params: { appName?: string, appId?: string, seed?:string }}>

const RemoteMethods = {
  IsReqConfirmationAnnounced: "is-req-conf-ann",
  LoadAppContextAndKey: "load-app-context",
}

@remoteApp
class Explorer extends CallablePlugin {
  APP_NAME="explorer"

  get keyManager(): KeyManager {
    return this.muon.getPlugin("key-manager");
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

  /**
   * For all nodes in announce list of app, this function confirms that app.onConfirm has been called on this node.
   */
  @gatewayMethod('req-check')
  async __checkRequest(data: CheckReqData) {
    const {request} = data?.params || {};
    if(!request)
      throw `request undefined`
    // @ts-ignore
    const appParty = this.appManager.getAppParty(request.appId, request.deploymentSeed)
    if(!appParty)
      throw `App party not found`;

    // @ts-ignore
    const {appId, reqId} = request;
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    let isValid = await app.verifyCompletedRequest(request as AppRequest, false)
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
      const {status, hasTssKey} = this.appManager.getAppDeploymentInfo(appId!, context.seed);
      return {
        status,
        hasTssKey,
        key: this.appManager.getAppTssKey(context.appId, context.seed)?.keyShare,
        keyGenReqId: context.keyGenRequest?.reqId,
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
      const statusList = contextStatuses
        .filter(ctx => ctx.seed !== GENESIS_SEED)
        .map(({status}) => status)
      if(statusList.includes(APP_STATUS_DEPLOYED))
        appStatus = APP_STATUS_DEPLOYED;
      else if(statusList.includes(APP_STATUS_PENDING))
        appStatus = APP_STATUS_PENDING
      else if(statusList.includes(APP_STATUS_ONBOARDING))
        appStatus = APP_STATUS_ONBOARDING
      else if(statusList.includes(APP_STATUS_EXPIRED))
        appStatus = APP_STATUS_EXPIRED
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

  @remoteMethod(RemoteMethods.LoadAppContextAndKey)
  async __loadAppContextAndKey(data: {appId:string, seed: string}, callerInfo: MuonNodeInfo) {
    const {appId, seed} = data
    if(!callerInfo.isDeployer && callerInfo.wallet !== process.env.SIGN_WALLET_ADDRESS)
      return;
    const {status, hasTssKey} = this.appManager.getAppDeploymentInfo(appId, seed)
    let contexts: AppContext[];
    if(status === 'NEW') {
      contexts = await this.appManager.queryAndLoadAppContext(appId);
      if(contexts.length===0)
        return;
      const ctx = contexts.find(ctx => ctx.seed === seed);
      if(!ctx || !ctx.party.partners.includes(this.nodeManager.currentNodeInfo!.id))
        return;
    }
  }
}

export default Explorer;
