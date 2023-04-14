import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import TimeoutPromise from "../../common/timeout-promise.js";
import {AppDeploymentInfo, AppDeploymentStatus, JsonPublicKey, MuonNodeInfo} from "../../common/types";
import TssPlugin from "./tss-plugin.js";
import BaseAppPlugin from "./base/base-app-plugin.js";
import CollateralInfoPlugin from "./collateral-info.js";
import * as CoreIpc from "../ipc.js";
import * as TssModule from '../../utils/tss/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import AppContext, {hash as hashAppContext} from "../../common/db-models/AppContext.js"
import AppTssConfig from "../../common/db-models/AppTssConfig.js"
import _ from 'lodash'
import {logger} from '@libp2p/logger'
import {pub2json} from "../../utils/helpers.js";
import {findMinFullyConnectedSubGraph} from "../../common/graph-utils/index.js";
import {PublicKey} from "../../utils/tss/types";
import {aesDecrypt, isAesEncrypted} from "../../utils/crypto.js";

const log = logger('muon:core:plugins:app-manager')

const RemoteMethods = {
  GetAppDeploymentInfo: "get-app-deployment-info",
  AppDeploymentInquiry: "app-deployment-inquiry",
  GetAppContext: "get-app-context",
  GetAppTss: "get-app-tss",
  GetAppPartyLatency: "get-app-latency"
}

@remoteApp
export default class AppManager extends CallablePlugin {
  private appContexts: { [index: string]: any } = {}
  private contextIdToAppIdMap: { [index: string]: string } = {}
  private appTssConfigs: { [index: string]: any } = {}
  private loading: TimeoutPromise = new TimeoutPromise();
  private deploymentPublicKey: PublicKey | null = null;

  async onStart() {
    await super.onStart()

    this.muon.on('app-context:add', this.onAppContextAdd.bind(this))
    this.muon.on('app-context:update', this.onAppContextUpdate.bind(this))
    this.muon.on('app-context:delete', this.onAppContextDelete.bind(this))
    this.muon.on('app-tss-key:add', this.onAppTssConfigAdd.bind(this))
    this.muon.on('global-tss-key:generate', this.onDeploymentTssKeyGenerate.bind(this));

    this.muon.on("collateral:node:add", this.onNodeAdd.bind(this));
    this.muon.on("collateral:node:delete", this.onNodeDelete.bind(this));

    await this.loadAppsInfo()
  }

  onNodeAdd(nodeInfo: MuonNodeInfo) {
    if (!this.isLoaded())
      return;
    if (nodeInfo.isDeployer) {
      let deploymentContext = this.appContexts['1'];
      deploymentContext.party.partners = [
        ...deploymentContext.party.partners,
        nodeInfo.id
      ]
    }
  }

  onNodeDelete(nodeInfo: MuonNodeInfo) {
    if (!this.isLoaded())
      return;
    if (nodeInfo.isDeployer) {
      let deploymentContext = this.appContexts['1'];
      deploymentContext.party.partners = deploymentContext.party.partners.filter(id => id != nodeInfo.id)
    }
  }

  get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  async loadAppsInfo() {
    log('loading apps info ...')
    await this.collateralPlugin.waitToLoad();
    const currentNode = this.collateralPlugin.currentNodeInfo!;
    let deploymentTssPublicKey: any = undefined;
    if (currentNode && currentNode.isDeployer) {
      if (!!this.tssPlugin.tssKey) {
        deploymentTssPublicKey = pub2json(this.tssPlugin.tssKey.publicKey!)
      }
    }
    try {
      const allAppContexts = [
        /** deployment app context */
        {
          appId: '1',
          version: 0,
          appName: "deployment",
          isBuiltIn: true,
          party: {
            partners: this.collateralPlugin.filterNodes({isDeployer: true}).map(({id}) => id),
            t: this.collateralPlugin.TssThreshold,
            max: this.collateralPlugin.MaxGroupSize
          },
          publicKey: deploymentTssPublicKey,
        },
        /** other apps contexts */
        ...await AppContext.find({})
      ]

      const tssKeyContext = {}
      allAppContexts.forEach(ac => {
        if (ac.publicKey?.encoded) {
          tssKeyContext[ac.publicKey?.encoded] = ac;
        }
        this.appContexts[ac.appId] = ac;
      })
      log('apps contexts loaded.')

      const allTssKeys = await AppTssConfig.find({});
      allTssKeys.forEach(key => {
        if (tssKeyContext[key.publicKey.encoded]) {
          if(isAesEncrypted(key.keyShare))
            key.keyShare = aesDecrypt(key.keyShare, process.env.SIGN_WALLET_PRIVATE_KEY);
          this.appTssConfigs[key.appId] = key;
        }
      })
      log('apps tss keys loaded.')

      this.loading.resolve(true);
    } catch (e) {
      console.error(`core.AppManager.loadAppsInfo`, e);
    }
  }

  async onDeploymentTssKeyGenerate(tssKey) {
    const publicKey = TssModule.keyFromPublic(tssKey.publicKey);
    this.appContexts['1'].publicKey = pub2json(publicKey);
  }

  async saveAppContext(context: object) {
    context = _.omit(context, ["_id"]);
    // @ts-ignore
    const oldDoc = await AppContext.findOne({version: context.version, appId: context.appId})
    if (oldDoc) {
      _.assign(oldDoc, context)
      oldDoc.dangerousAllowToSave = true
      await oldDoc.save()
      CoreIpc.fireEvent({
        type: "app-context:add",
        data: context
      })
      return oldDoc
    }
    else {
      let newContext = new AppContext(context)
      /**
       * Do not use this code in any other place
       * Call this method as the base method for saving AppContext.
       */
      newContext.dangerousAllowToSave = true
      await newContext.save()
      CoreIpc.fireEvent({
        type: "app-context:add",
        data: context
      })

      return newContext;
    }
  }

  async deleteAppContext(_id: string) {
  }

  async saveAppTssConfig(appTssConfig: any) {
    // @ts-ignore
    if (appTssConfig.keyShare) {
      let newConfig = new AppTssConfig(appTssConfig)
      /**
       * Do not use this code in any other place
       * Call this method as the base method for saving AppTssConfig.
       */
      newConfig.dangerousAllowToSave = true
      await newConfig.save()
      CoreIpc.fireEvent({
        type: "app-tss-key:add",
        data: newConfig
      })
    }

    // @ts-ignore
    const {appId, version, publicKey} = appTssConfig;
    const context = await AppContext.findOne({_id: appTssConfig.context}).exec();
    // @ts-ignore
    context.publicKey = publicKey
    context.dangerousAllowToSave = true
    await context.save();
    CoreIpc.fireEvent({
      type: "app-context:update",
      data: context,
    })
  }

  async deleteAppTssKey() {
  }

  private async onAppContextAdd(doc) {
    log(`app context add %o`, doc)
    this.appContexts[doc.appId] = doc;
    this.contextIdToAppIdMap[doc._id] = doc.appId
  }

  private async onAppContextUpdate(doc) {
    log(`app context update %o`, doc)
    this.appContexts[doc.appId] = doc;
    this.contextIdToAppIdMap[doc._id] = doc.appId
  }

  private async onAppContextDelete(data: { appId: string, contexts: any[] }) {
    try {
      const {appId, contexts} = data
      if (!appId || !Array.isArray(contexts)) {
        log.error('missing appId/contexts.');
        return;
      }

      log(`pid[${process.pid}] app[${appId}] context deleting...`)
      const deploymentReqIds = contexts.map(c => c.deploymentRequest.reqId)
      if (!this.appContexts[appId] || !deploymentReqIds.includes(this.appContexts[appId].deploymentRequest.reqId)) {
        // log.error(`pid[${process.pid}] AppContext deleted but app data not found ${appId}`)
        return
      }
      delete this.appContexts[appId]
      delete this.appTssConfigs[appId]
      log(`app[${appId}] context deleted.`)
    } catch (e) {
      log(`error when deleting app context %O`, e);
    }
  }

  private async onAppTssConfigAdd(doc) {
    log(`app tss config add %o`, _.omit(doc, ['keyShare']))
    if(isAesEncrypted(doc.keyShare))
      doc.keyShare = aesDecrypt(doc.keyShare, process.env.SIGN_WALLET_PRIVATE_KEY)
    this.appTssConfigs[doc.appId] = doc;
  }

  private async onAppTssConfigChange(change) {
    // console.log("====== AppTssConfig:change ======", JSON.stringify(change))
    switch (change.operationType) {
      case "replace": {
        const doc = change.fullDocument;
        if(isAesEncrypted(doc.keyShare))
          doc.keyShare = aesDecrypt(doc.keyShare, process.env.SIGN_WALLET_PRIVATE_KEY)
        this.appTssConfigs[doc.appId] = doc;

        try {
          /** TssPlugin needs to refresh tss key info */
          // @ts-ignore
          await this.emit("app-tss:delete", doc.appId, doc)
        } catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      case "delete": {
        let documentId = change.documentKey._id.toString();
        try {
          const appId = Object.keys(this.appTssConfigs).find(appId => (this.appTssConfigs[appId]._id.toString() === documentId))
          if (!appId) {
            console.error(`AppTssConfig deleted but appId not found`, change)
            return
          }
          const appTssConfig = this.appTssConfigs[appId]
          delete this.appTssConfigs[appId]
          // @ts-ignore
          await this.emit("app-tss:delete", appId, appTssConfig)
        } catch (e) {
          console.log(`AppManager.onAppTssConfigChange`, e);
        }
        break
      }
      default:
        console.log(`AppManager.onAppContextChange`, JSON.stringify(change))
    }
  }

  getAppDeploymentInfo(appId: string): AppDeploymentInfo {
    if (!this.appIsDeployed(appId)) {
      return {
        appId,
        deployed: false,
        status: this.getAppDeploymentStatus(appId),
      }
    }
    if (!this.appHasTssKey(appId)) {
      return {
        appId,
        deployed: true,
        status: this.getAppDeploymentStatus(appId),
        version: -1
      }
    }
    const context = this.getAppContext(appId)
    return {
      appId,
      deployed: true,
      status: this.getAppDeploymentStatus(appId),
      version: context.version,
      reqId: appId === '1' ? null : context.deploymentRequest.reqId,
      contextHash: hashAppContext(context),
    }
  }

  async queryAndLoadAppContext(appId) {
    /** Ignore query if found local. */
    if(this.appContexts[appId])
      return this.appContexts[appId];

    /** query only deployer nodes */
    const deployerNodes: string[] = this.collateralPlugin
      .filterNodes({
        isDeployer: true,
        excludeSelf: true
      })
      .map(p => p.peerId)

    /** find 3 online deployer to do query */
    const candidateNodePeerIds: string[] = await NetworkIpc.findNOnlinePeer(deployerNodes, 3, {timeout: 10000, return: 'peerId'});

    log(`calling deployer nodes to get app context `)
    // @ts-ignore
    const context = await Promise.any(
      candidateNodePeerIds.map(peerId => {
        return this.remoteCall(
          peerId,
          RemoteMethods.GetAppContext,
          appId,
          {timeout: 5000}
        )
          .then(context => {
            if(!context)
              throw `not found`
            return context;
          })
      })
    )
      .catch(e => null);
    if(context) {
      log(`app context found.`)
      try {
        const savedContext = await this.saveAppContext(context);
        return savedContext;
      } catch (e) {
        log.error("error when storing context %o", e);
        return null;
      }
    }
    else {
      log.error('app context not found.')
      return null
    }
  }

  tssKeyQueryResult = {}

  async queryAndLoadAppTssKey(appId) {
    if (!this.appIsDeployed(appId))
      return null;

    /** cache for 30 minutes */
    if (this.tssKeyQueryResult[appId]) {
      if (Date.now() - this.tssKeyQueryResult[appId].time < 30e3)
        return this.tssKeyQueryResult[appId].result;
    }

    let appContext = this.appContexts[appId];

    /** refresh result */
    const appParty: MuonNodeInfo[] = this.collateralPlugin
      .filterNodes({
        list: appContext.party.partners,
        excludeSelf: true
      })

    log(`calling app party to get app tss key ...`)

    let callResult = await Promise.all(
      appParty.map(node => {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.GetAppTss,
          appId,
          {timeout: 15000}
        )
          .then(result => {
            const {publicKey} = result;
            if(!TssModule.validatePublicKey(publicKey))
              throw "invalid public key"
            return publicKey
          })
          .catch(e => {
            if (process.env.VERBOSE)
              console.error(`core.AppManager.queryAndLoadAppTssKey [GetAppTss] Error`, e);
            return "error"
          })
      })
    );

    const counts: any = callResult.filter(r => !!r)
      .reduce((counts, publicKey) => {
        const {max} = counts;
        if(!counts[publicKey])
          counts[publicKey] = 1;
        else
          counts[publicKey] ++;
        if(max === null || counts[publicKey] > counts[max])
          counts.max = publicKey;
        return counts;
      }, {max: null})

    if (!counts.max || counts[counts.max] < appContext.party.t) {
      this.tssKeyQueryResult[appId] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    const publicKey = TssModule.keyFromPublic(counts.max)
    const result = {
      appId,
      version: 0,
      publicKey: pub2json(publicKey)
    }

    this.tssKeyQueryResult[appId] = {
      time: Date.now(),
      result: result
    }

    return result;
  }

  appIsDeployed(appId: string): boolean {
    return appId == '1' || !!this.appContexts[appId]
  }

  appIsBuiltIn(appId: string): boolean {
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    return app.isBuiltInApp;
  }

  getAppContext(appId: string) {
    return this.appContexts[appId];
  }

  getAppDeploymentStatus(appId: string): AppDeploymentStatus {
    let context = this.getAppContext(appId);

    let statusCode = 0
    if (!!context)
      statusCode++;
    if (this.appHasTssKey(appId))
      statusCode++;

    return ["NEW", "TSS_GROUP_SELECTED", "DEPLOYED"][statusCode] as AppDeploymentStatus;
  }

  appHasTssKey(appId: string): boolean {
    if (appId == '1') {
      const nodeInfo = this.collateralPlugin.currentNodeInfo!
      return nodeInfo?.isDeployer && !!this.tssPlugin.tssKey
    } else {
      return !!this.appTssConfigs[appId];
    }
  }

  getAppTssKey(appId: string) {
    return this.appTssConfigs[appId];
  }

  /** useful when current node is not in the app party */
  publicKeyQueryTime = 0;
  async findTssPublicKey(appId: string): Promise<PublicKey | null> {
    if(appId === '1') {
      const currentNode: MuonNodeInfo = this.collateralPlugin.currentNodeInfo!;
      if(currentNode.isDeployer) {
        return this.tssPlugin.tssKey?.publicKey || null;
      }
      else {
        if(!this.deploymentPublicKey && this.publicKeyQueryTime + 2*60e3 < Date.now()) {
          this.publicKeyQueryTime = Date.now();

          const deployers: MuonNodeInfo[] = _.shuffle(this.collateralPlugin.filterNodes({isDeployer: true}));
          // @ts-ignore
          const publicKeyStr = await Promise.any(
            deployers.slice(0, 3).map(n => {
              return this.remoteCall(
                n.peerId,
                RemoteMethods.GetAppTss,
                appId,
                {timeout: 5000}
              )
                .then(result => {
                  if(!result)
                    throw `missing publicKey`
                  return result.publicKey
                })
            })
          )
          this.deploymentPublicKey = TssModule.keyFromPublic(publicKeyStr);
        }
        return this.deploymentPublicKey;
      }
    }
    else {
      /** if key exist in current node */
      let appContest = this.getAppContext(appId)
      if (!appContest)
        appContest = await this.queryAndLoadAppContext(appId)
      if (appContest?.publicKey)
        return TssModule.keyFromPublic(appContest.publicKey.encoded);
      else
        return null;
    }
  }

  isLoaded() {
    return this.loading.isFulfilled;
  }

  waitToLoad() {
    return this.loading.promise;
  }

  /**
   * @param searchList {string[]} - id/wallet/peerId list of nodes to check.
   * @param count {number} - enough count of results to resolve the promise.
   * @param options
   * @param options.appId {string} - if has value, the nodes that has ready app tss key, will be selected.
   * @param options.timeout {number} - times to wait for remote response (in millisecond)
   */
  async findNAvailablePartners(appId: string, searchList: string[], count: number, options: { timeout?: number, return?: string } = {}): Promise<string[]> {
    options = {
      timeout: 15000,
      return: 'id',
      ...options
    }
    let peers = this.collateralPlugin.filterNodes({list: searchList})
    log(`finding ${count} of ${searchList.length} available peer ...`)
    const selfIndex = peers.findIndex(p => p.peerId === process.env.PEER_ID!)

    let responseList: string[] = []
    let n = count;
    if (selfIndex >= 0) {
      peers = peers.filter((_, i) => (i !== selfIndex))
      const status = this.getAppDeploymentStatus(appId)
      if (status === 'DEPLOYED')
        responseList.push(this.currentNodeInfo![options!.return!]);
      n--;
    }

    let resultPromise = new TimeoutPromise(
      options.timeout,
      `Finding ${count} from ${searchList.length} peer timed out`,
      {
        resolveOnTimeout: true,
        onTimeoutResult: () => {
          return responseList;
        }
      }
    );

    let pendingRequests = peers.length
    const execTimes = new Array(peers.length).fill(-1)
    const startTime = Date.now()
    let finalized = false;
    for (let i = 0; i < peers.length; i++) {
      this.remoteCall(
        peers[i].peerId,
        RemoteMethods.GetAppDeploymentInfo,
        appId,
        {timeout: options!.timeout},
      )
        .then(({status}) => {
          execTimes[i] = Date.now() - startTime
          if (status === "DEPLOYED") {
            responseList.push(peers[i][options!.return!])
            n--;
          }
        })
        .catch(e => {
          log.error("get deployment status has been failed %O", e)
        })
        .finally(() => {
          if (n <= 0) {
            if (!finalized)
              log("find availability exec times %o, nodes: %o", execTimes, peers.map(p => p.id))
            finalized = true
            resultPromise.resolve(responseList);
          }
          if (--pendingRequests <= 0) {
            if (!finalized)
              log("find availability exec times %o, nodes: %o", execTimes, peers.map(p => p.id))
            finalized = true
            resultPromise.resolve(responseList);
          }
        })
    }

    return resultPromise.promise;
  }

  async findOptimalAvailablePartners(appId: string, count: number, options: { timeout?: number, return?: string } = {}): Promise<string[]> {
    options = {
      //TODO: find N best partners instead of setting timeout
      timeout: 3000,
      return: 'id',
      ...options
    }
    const context = this.getAppContext(appId)
    if (!context)
      throw `app not deployed`;

    let peers = this.collateralPlugin.filterNodes({list: context.party.partners})
    log(`finding ${count} optimal available of ${context.appName} app partners ...`)

    let responseTimes = await Promise.all(
      peers.map(p => {
        return (
          p.wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__getAppPartyLatency({appId}, this.collateralPlugin.currentNodeInfo)
          :
          this.remoteCall(
            p.peerId,
            RemoteMethods.GetAppPartyLatency,
            {appId},
            {timeout: options.timeout}
          )
        )
          .catch(e => null)
      })
    )
    responseTimes = responseTimes.reduce((obj, r, i) => (obj[peers[i].id]=r, obj), {});
    const graph = {}
    for(const [receiver, times] of Object.entries(responseTimes)) {
      if(times === null)
        continue;
      for(const [sender, time] of Object.entries(times)) {
        if(time === null)
          continue ;
        if(!graph[sender])
          graph[sender] = {}
        graph[sender][receiver] = time;
      }
    }
    const minGraph = findMinFullyConnectedSubGraph(graph, count);
    return Object.keys(minGraph)
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.GetAppDeploymentInfo)
  async __getAppDeploymentInfo(appId: string): Promise<AppDeploymentInfo> {
    return this.getAppDeploymentInfo(appId);
  }

  @remoteMethod(RemoteMethods.AppDeploymentInquiry)
  async __appDeploymentInquiry(appId, callerInfo) {
    return this.appIsDeployed(appId) ? "yes" : 'no';
  }

  @remoteMethod(RemoteMethods.GetAppContext)
  async __getAppContext(appId, callerInfo) {
    return this.getAppContext(appId)
  }

  @remoteMethod(RemoteMethods.GetAppTss)
  async __getAppTss(appId, callerInfo) {
    let publicKey:JsonPublicKey|null = null;

    if(appId === '1') {
      const currentNode: MuonNodeInfo = this.collateralPlugin.currentNodeInfo!
      publicKey = currentNode.isDeployer ? pub2json(this.tssPlugin.tssKey?.publicKey!) : null
    }
    else {
      publicKey = this.getAppTssKey(appId)?.publicKey;
    }

    if (!publicKey)
      return null;

    return {
      version: 0,
      publicKey: publicKey.encoded,
    }
  }

  @remoteMethod(RemoteMethods.GetAppPartyLatency)
  async __getAppPartyLatency(data: { appId: string }, callerInfo) {
    const {appId} = data;
    if (!appId)
      throw `appId not defined`;
    const context = this.getAppContext(appId)
    if (!context)
      throw `app not deployed`
    const peers = this.collateralPlugin.filterNodes({list: context.party.partners})
    const startTime = Date.now();
    const responses = await Promise.all(
      peers.map(p => {
        return (
          p.wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__getAppDeploymentInfo(appId)
          :
          this.remoteCall(
            p.peerId,
            RemoteMethods.GetAppDeploymentInfo,
            appId,
            {timeout: 3000}
          )
        )
          .then(({status}) => {
            if (status !== 'DEPLOYED')
              return null;
            return Date.now() - startTime
          })
          .catch(e => null)
      })
    )
    return responses.reduce((obj, r, i) => (obj[peers[i].id]=r, obj), {});
  }
}
