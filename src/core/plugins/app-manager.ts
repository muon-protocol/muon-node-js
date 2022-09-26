import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators'
import TimeoutPromise from "../../common/timeout-promise";
import {AppDeploymentStatus, MuonNodeInfo} from "../../common/types";
import TssPlugin from "./tss-plugin";
import BaseAppPlugin from "./base/base-app-plugin";
import CollateralInfoPlugin from "./collateral-info";
const AppContext = require("../../common/db-models/AppContext")
const AppTssConfig = require("../../common/db-models/AppTssConfig")

const appContextEventEmitter = AppContext.watch()
const appTssConfigEventEmitter = AppTssConfig.watch()

const RemoteMethods = {
  AppStatus: "app-status",
  AppDeploymentInquiry: "app-deployment-inquiry",
  AppDeploymentInfo: "app-deployment-info",
}

@remoteApp
export default class AppManager extends CallablePlugin {
  private appContexts: {[index: string]: any} = {}
  private globalContext;
  private contextIdToAppIdMap: {[index: string]: string}={}
  private appTssConfigs: {[index: string]: any} = {}
  private loading: TimeoutPromise = new TimeoutPromise();

  async onStart() {
    await super.onStart()

    this.loadAppsInfo()

    appContextEventEmitter.on('change', this.onAppContextChange.bind(this))
    appTssConfigEventEmitter.on('change', this.onAppTssConfigChange.bind(this))

    await this.collateralPlugin.waitToLoad();

    this.globalContext = {
      deployed: true,
      appId: 0,
      version: 1,
      party: {
        partners: this.collateralPlugin.groupInfo?.partners,
        t: this.collateralPlugin.networkInfo?.tssThreshold,
        max: this.collateralPlugin.networkInfo?.maxGroupSize,
      }
    }
  }

  get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  async loadAppsInfo() {
    try {
      const allAppContexts = await AppContext.find({});
      allAppContexts.forEach(ac => {
        this.appContexts[ac.appId] = ac;
        this.contextIdToAppIdMap[ac._id] = ac.appId
      })

      const allTssKeys = await AppTssConfig.find({});
      allTssKeys.forEach(key => {
        const appId = this.contextIdToAppIdMap[key.context];
        this.appTssConfigs[appId] = key;
      })

      this.loading.resolve(true);
    }catch (e) {
      console.log(`AppManager.loadAppsInfo`, e);
    }
  }

  async onAppContextChange(change) {
    // console.log("====== AppContext:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        const doc = change.fullDocument;
        this.appContexts[doc.appId] = doc;
        this.contextIdToAppIdMap[doc._id] = doc.appId
        break
      }
      // case "replace": {
      //   break
      // }
      // case "delete": {
      //   break
      // }
      default:
        console.log(`AppManager.onAppContextChange`, change)
    }
  }

  async loadAppContextFromNetwork(holders: MuonNodeInfo[], status: AppDeploymentStatus) {
    for(let i=0 ; i<holders.length ; i++) {
      let data = await this.remoteCall(
        holders[i].peerId,
        RemoteMethods.AppDeploymentInfo,
        status.appId
      )
      if(data) {
        try {
          const context = new AppContext(data);
          await context.save();
          return context;
        }catch (e) {}
      }
    }
  }

  async getAppStatus(appId: string): Promise<AppDeploymentStatus> {
    if(!this.appIsDeployed(appId))
      return {appId, deployed: false}
    if(!this.appHasTssKey(appId))
      return {appId, deployed: true, version: -1}
    const context = this.getAppContext(appId)
    return {
      appId,
      deployed: true,
      version: context.version,
      reqId: context.deploymentRequest.reqId,
    }
  }

  appQueryResult = {}
  async queryAndLoadAppContext(appId) {
    /** cache for 5 minutes */
    if(this.appQueryResult[appId]){
      if(Date.now() - this.appQueryResult[appId].time < 5*60*60*1000)
        return this.appQueryResult[appId].result;
    }
    /** refresh result */
    const remoteNodes = Object.values(this.tssPlugin.tssParty!.onlinePartners);
    let callResult = await Promise.all(remoteNodes.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS)
        return this.getAppStatus(appId)
      return this.remoteCall(
        node.peerId,
        RemoteMethods.AppStatus,
        appId,
        {timeout: 15000}
      )
        .catch(e => "error")
    }));
    const threshold = this.tssPlugin.TSS_THRESHOLD;
    const trueCallResult = callResult.filter(r => r?.deployed)
    if(trueCallResult.length < threshold)
      return {appId, deployed: false};

    const versionCounts = {'-1': 0}
    trueCallResult.forEach(({version, reqId}) => {
      const idx = `${version}@${reqId}`
      if(versionCounts[idx] === undefined)
        versionCounts[idx] = 1
      else
        versionCounts[idx] ++;
    })
    let maxVersion = '-1'
    Object.keys(versionCounts).forEach(version => {
      if(version != '-1' && versionCounts[version] >= threshold && versionCounts[version] > versionCounts[maxVersion])
        maxVersion = version
    })
    if(versionCounts[maxVersion] < threshold)
      return {appId, deployed: false}
    const [version, reqId] = maxVersion.split('@')

    const result = {
      appId,
      deployed: true,
      reqId,
      version: parseInt(version)
    }
    this.appQueryResult[appId] = {
      time: Date.now(),
      result
    }

    // @ts-ignore
    let holders: MuonNodeInfo[] = callResult
      .map((r, i) => {
        if(r.deployed && r.version===result.version)
          return remoteNodes[i]
        else
          return null;
      })
      .filter(h => !!h)
    const context = await this.loadAppContextFromNetwork(holders, result)
    return context
  }

  async onAppTssConfigChange(change) {
    // console.log("====== AppTssConfig:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        const doc = change.fullDocument;
        const appId = this.contextIdToAppIdMap[doc.context];
        this.appTssConfigs[appId] = doc;
        break
      }
      case "replace": {
        const doc = change.fullDocument;
        const appId = this.contextIdToAppIdMap[doc.context];
        this.appTssConfigs[appId] = doc;

        try {
          /** TssPlugin needs to refresh tss key info */
          await this.emit("app-tss:delete", appId, doc)
        }
        catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      case "delete": {
        let documentId = change.documentKey._id.toString();
        try {
          const appId = Object.keys(this.appTssConfigs).find(appId => (this.appTssConfigs[appId]._id.toString() === documentId))
          if(!appId) {
            console.error(`AppTssConfig deleted but appId not found`, change)
            return
          }
          const appTssConfig = this.appTssConfigs[appId]
          delete this.appTssConfigs[appId]
          await this.emit("app-tss:delete", appId, appTssConfig)
        }
        catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, JSON.stringify(change))
    }
  }

  appIsDeployed(appId: string): boolean {
    return !!this.appContexts[appId]
  }

  appIsBuiltIn(appName: string): boolean {
    const app: BaseAppPlugin = this.muon._apps[appName]
    return app.isBuiltInApp;
  }

  getAppContext(appId: string) {
    return this.appContexts[appId];
  }

  getGlobalContext() {
    return this.globalContext;
  }

  appHasTssKey(appId: string): boolean {
    return !!this.appTssConfigs[appId];
  }

  getAppTssKey(appId: string) {
    return this.appTssConfigs[appId];
  }

  isLoaded() {
    return this.loading.isFulfilled;
  }

  waitToLoad() {
    return this.loading.promise;
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.AppStatus)
  async __returnAppStatus(appId): Promise<AppDeploymentStatus> {
    return this.getAppStatus(appId);
  }

  @remoteMethod(RemoteMethods.AppDeploymentInquiry)
  async __appDeploymentInquiry(appId, callerInfo) {
    return this.appIsDeployed(appId) ? "yes" : 'no';
  }

  @remoteMethod(RemoteMethods.AppDeploymentInfo)
  async __appDeploymentData(appId, callerInfo) {
    return this.getAppContext(appId)
  }
}
