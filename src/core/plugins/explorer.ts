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
import CollateralInfoPlugin from "./collateral-info.js";
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

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
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
    let nodeInfo = this.collateralPlugin.getNodeInfo(id)!
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

  // @gatewayMethod("node-peer")
  // async __nodePeerInfo(data: GetNodeInfo) {
  //   let {id} = data?.params || {}
  //   if(!id) {
  //     throw `id is undefined`
  //   }
  //   let nodeInfo = this.collateralPlugin.getNodeInfo(id)!
  //   if(!nodeInfo) {
  //     throw `unknown peer`
  //   }
  //   return {
  //     peerInfo: await NetworkIpc.getPeerInfoLight(nodeInfo.peerId)
  //   }
  // }

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

    const partners = this.collateralPlugin.filterNodes({list: listToCheck});
    const announced: boolean[] = await Promise.all(partners.map(node => {
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
    const announceMap: MapOf<boolean> = partners.reduce((obj, {id}, i) => (obj[id]=announced[i], obj), {})

    return {
      isValid,
      tss: {
        t: appParty.t,
        n: appParty.max
      },
      hasAnnouncement,
      announceGroups,
      groupsAnnounced: announceGroups.map(group => {
        return group.reduce((obj, id) => (obj[id]=announceMap[id], obj), {})
      })
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

  private async getContextPartnersStatus(context: AppContext, statusCode: number) {
    const {appId, seed} = context
    let partnersStatus;
    if(context && statusCode > 0) {
      const partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
        list: context.party?.partners || []
      })
      const responses = await Promise.all(
        partners.map(n => {
          if(n.wallet === process.env.SIGN_WALLET_ADDRESS)
            return this.__getAppDeploymentStatus({appId, seed}, this.collateralPlugin.currentNodeInfo!)
          return this.remoteCall(
            n.peerId,
            RemoteMethods.AppDeploymentStatus,
            {appId, seed},
            {timeout: 5000}
          )
            .catch(e => null)
        })
      )
      partnersStatus = responses.reduce((obj, result, index) => {
        const node = partners[index]
        obj[node.id] = result
        if(node.wallet === process.env.SIGN_WALLET_ADDRESS){
          this.__loadAppContextAndKey({appId, seed}, this.collateralPlugin.currentNodeInfo!)
            .catch(e => {
            })
        }
        else {
          /** call remote node to load app context*/
          this.remoteCall(
            node.peerId,
            RemoteMethods.LoadAppContextAndKey,
            {appId, seed}
          )
            .catch(e => {
            })
        }

        return obj
      }, {})
    }
    return partnersStatus;
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
          partners: context.party?.partners,
        },
        // partnersStatus: await this.getContextPartnersStatus(context[0], statusCode),
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
      if(!ctx || !ctx.party.partners.includes(this.collateralPlugin.currentNodeInfo!.id))
        return;
    }
    if(status !== 'DEPLOYED') {
      await timeout(2000)
      await this.tssPlugin.checkAppTssKeyRecovery(appId, seed);
    }
  }
}

export default Explorer;
