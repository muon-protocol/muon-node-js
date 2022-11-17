import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators'
import TimeoutPromise from "../../common/timeout-promise";
import {AppDeploymentStatus, MuonNodeInfo} from "../../common/types";
import TssPlugin from "./tss-plugin";
import BaseAppPlugin from "./base/base-app-plugin";
import CollateralInfoPlugin from "./collateral-info";
const TssModule = require('../../utils/tss');
const AppContext = require("../../common/db-models/AppContext")
const AppTssConfig = require("../../common/db-models/AppTssConfig")

const appContextEventEmitter = AppContext.watch()
const appTssConfigEventEmitter = AppTssConfig.watch()

const RemoteMethods = {
  AppStatus: "app-status",
  AppDeploymentInquiry: "app-deployment-inquiry",
  AppDeploymentInfo: "app-deployment-info",
  GetAppTss: "get-app-tss",
}

@remoteApp
export default class AppManager extends CallablePlugin {
  private appContexts: {[index: string]: any} = {}
  private contextIdToAppIdMap: {[index: string]: string}={}
  private appTssConfigs: {[index: string]: any} = {}
  private loading: TimeoutPromise = new TimeoutPromise();

  async onStart() {
    await super.onStart()

    appContextEventEmitter.on('change', this.onAppContextChange.bind(this))
    appTssConfigEventEmitter.on('change', this.onAppTssConfigChange.bind(this))
    this.muon.on("node:add", this.onNodeAdd.bind(this));
    this.muon.on("node:delete", this.onNodeDelete.bind(this));

    await this.loadAppsInfo()
  }

  onNodeAdd(nodeInfo: MuonNodeInfo) {
    if(!this.isLoaded())
      return;
    let deploymentContext = this.appContexts['1'];
    deploymentContext.party.partners = [
      ...deploymentContext.party.partners,
      nodeInfo.id
    ]
  }

  onNodeDelete(nodeInfo: MuonNodeInfo) {
    if(!this.isLoaded())
      return;
    let deploymentContext = this.appContexts['1'];
    deploymentContext.party.partners = deploymentContext.party.partners.filter(id => id != nodeInfo.id)
  }

  get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  async loadAppsInfo() {
    await this.collateralPlugin.waitToLoad();
    try {
      const allAppContexts = await AppContext.find({});
      this.appContexts['1'] = {
        appId: '1',
        version: 0,
        appName: "deployment",
        isBuiltIn: true,
        party: {
          partners: this.collateralPlugin.groupInfo.partners,
          t: this.collateralPlugin.TssThreshold,
          max: this.collateralPlugin.MaxGroupSize
        }
      }

      allAppContexts.forEach(ac => {
        this.appContexts[ac.appId] = ac;
      })

      const allTssKeys = await AppTssConfig.find({});
      allTssKeys.forEach(key => {
        this.appTssConfigs[key.appId] = key;
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
      case "delete": {
        let documentId = change.documentKey._id.toString();
        try {
          const contextId = Object.keys(this.appContexts).find(contextId => (this.appContexts[contextId]._id.toString() === documentId))
          if(!contextId) {
            console.error(`AppContext deleted but contextId not found`, change)
            return
          }
          const appContext = this.appContexts[contextId]
          delete this.appContexts[contextId]
          await this.emit("app-context:delete", contextId, appContext)
        }
        catch (e) {
          console.log(`AppManager.onAppContextChange`, e);
        }
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, change)
    }
  }

  async loadAppContextFromNetwork(holders: MuonNodeInfo[], appId: string) {
    for(let i=0 ; i<holders.length ; i++) {
      let data = await this.remoteCall(
        holders[i].peerId,
        RemoteMethods.AppDeploymentInfo,
        appId
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
      contextHash: AppContext.hash(context),
    }
  }

  appQueryResult = {}
  async queryAndLoadAppContext(appId) {
    /** cache for 5 minutes */
    if(this.appQueryResult[appId]){
      if(Date.now() - this.appQueryResult[appId].time < 5*60*1000)
        return this.appQueryResult[appId].result;
    }
    /** refresh result */
    const remoteNodes: MuonNodeInfo[] = Object.values(this.tssPlugin.tssParty!.onlinePartners);
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
    if(trueCallResult.length < threshold) {
      this.appQueryResult[appId] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    const hashCounts = {}
    trueCallResult.forEach(({contextHash: hash}) => {
      if(hashCounts[hash] === undefined)
        hashCounts[hash] = 1
      else
        hashCounts[hash] ++;
    })
    let maxHash = ''
    Object.keys(hashCounts).forEach(hash => {
      if(!maxHash)
        maxHash = hash
      else if(hashCounts[hash] > hashCounts[maxHash])
        maxHash = hash
    })
    if(hashCounts[maxHash] < threshold){
      this.appQueryResult[appId] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    /**
     * the nodes, who has the app context data.
     */
    // @ts-ignore
    let holders: MuonNodeInfo[] = callResult
      .map((r, i) => {
        if(r.deployed && r.contextHash===maxHash)
          return remoteNodes[i]
        else
          return null;
      })
      .filter(h => !!h)
    const context = await this.loadAppContextFromNetwork(holders, appId)
    this.appQueryResult[appId] = {
      time: Date.now(),
      result: context || null
    }
    return context
  }

  tssKeyQueryResult = {}
  async queryAndLoadAppTssKey(appId) {
    if(!this.appIsDeployed(appId))
      return null;
    /** cache for 5 minutes */
    if(this.tssKeyQueryResult[appId]){
      if(Date.now() - this.tssKeyQueryResult[appId].time < 5*60*1000)
        return this.tssKeyQueryResult[appId].result;
    }
    let appContext = this.appContexts[appId];
    let partnersId = appContext.party.partners;

    /** refresh result */
    const remoteNodes: MuonNodeInfo[] = partnersId
        .map(id => this.collateralPlugin.getNodeInfo(id))
        .filter(n => (n.isOnline && n.wallet !== process.env.SIGN_WALLET_ADDRESS))

    let callResult = await Promise.all(remoteNodes.map(node => {
      return this.remoteCall(
        node.peerId,
        RemoteMethods.GetAppTss,
        appId,
        {timeout: 15000}
      )
        .catch(e => {
          if(process.env.VERBOSE)
            console.error(`core.AppManager.queryAndLoadAppTssKey [GetAppTss] Error`, e);
          return "error"
        })
    }));
    const threshold = this.tssPlugin.TSS_THRESHOLD;
    const trueCallResult = callResult.filter(r => !!r)
    if(trueCallResult.length < threshold) {
      this.tssKeyQueryResult[appId] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    const hashCounts = {}
    trueCallResult.forEach(r => {
      let hash = `${r.version}.${r.publicKey}`
      if(hashCounts[hash] === undefined)
        hashCounts[hash] = 1
      else
        hashCounts[hash] ++;
    })
    let maxHash = ''
    Object.keys(hashCounts).forEach(hash => {
      if(!maxHash)
        maxHash = hash
      else if(hashCounts[hash] > hashCounts[maxHash])
        maxHash = hash
    })
    if(hashCounts[maxHash] < threshold){
      this.tssKeyQueryResult[appId] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    let [version, publicKeyEncoded] = maxHash.split('.');

    const publicKey = TssModule.keyFromPublic(publicKeyEncoded.replace("0x", ""), "hex")
    const result = {
      appId,
      version: parseInt(version),
      publicKey: {
        address: TssModule.pub2addr(publicKey),
        encoded: publicKeyEncoded,
        x: '0x' + publicKey.getX().toBuffer('be', 32).toString('hex'),
        yParity: publicKey.getY().isEven() ? 0 : 1
      }
    }
    this.tssKeyQueryResult[appId] = {
      time: Date.now(),
      result: result
    }

    return result;
  }

  async onAppTssConfigChange(change) {
    // console.log("====== AppTssConfig:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "insert": {
        const doc = change.fullDocument;
        this.appTssConfigs[doc.appId] = doc;
        break
      }
      case "replace": {
        const doc = change.fullDocument;
        this.appTssConfigs[doc.appId] = doc;

        try {
          /** TssPlugin needs to refresh tss key info */
          await this.emit("app-tss:delete", doc.appId, doc)
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
    return appId=='1' || !!this.appContexts[appId]
  }

  appIsBuiltIn(appId: string): boolean {
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    return app.isBuiltInApp;
  }

  getAppContext(appId: string) {
    // if(appId == '1') {
    //   return this._deploymentContext;
    // }
    return this.appContexts[appId];
  }

  appHasTssKey(appId: string): boolean {
    return appId=='1' || !!this.appTssConfigs[appId];
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
    return await this.getAppStatus(appId);
  }

  @remoteMethod(RemoteMethods.AppDeploymentInquiry)
  async __appDeploymentInquiry(appId, callerInfo) {
    return this.appIsDeployed(appId) ? "yes" : 'no';
  }

  @remoteMethod(RemoteMethods.AppDeploymentInfo)
  async __appDeploymentData(appId, callerInfo) {
    return this.getAppContext(appId)
  }

  @remoteMethod(RemoteMethods.GetAppTss)
  async __getAppTss(appId, callerInfo) {
    const tssKey = this.getAppTssKey(appId)
    if(!tssKey)
      return null;
    return {
      version: tssKey.version,
      publicKey: tssKey.publicKey.encoded,
    }
  }
}
