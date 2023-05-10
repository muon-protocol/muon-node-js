import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import TimeoutPromise from "../../common/timeout-promise.js";
import {
  AppContext,
  AppDeploymentInfo,
  AppDeploymentStatus,
  AppTssConfig,
  JsonPublicKey,
  MuonNodeInfo
} from "../../common/types";
import TssPlugin from "./tss-plugin.js";
import BaseAppPlugin from "./base/base-app-plugin.js";
import CollateralInfoPlugin from "./collateral-info.js";
import * as CoreIpc from "../ipc.js";
import * as TssModule from '../../utils/tss/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import AppContextModel, {hash as hashAppContext} from "../../common/db-models/app-context.js"
import AppTssConfigModel from "../../common/db-models/app-tss-config.js"
import _ from 'lodash'
import {logger} from '@libp2p/logger'
import {getTimestamp, pub2json, statusCodeToTitle} from "../../utils/helpers.js";
import {findMinFullyConnectedSubGraph} from "../../common/graph-utils/index.js";
import {PublicKey} from "../../utils/tss/types";
import {aesDecrypt, isAesEncrypted} from "../../utils/crypto.js";
import {MapOf} from "../../common/mpc/types";

const log = logger('muon:core:plugins:app-manager')

const RemoteMethods = {
  GetAppDeploymentInfo: "get-app-deployment-info",
  AppDeploymentInquiry: "app-deployment-inquiry",
  GetAppContext: "get-app-context",
  GetAppTss: "get-app-tss",
  GetAppPartyLatency: "get-app-latency"
}

export type AppContextQueryOptions = {
  seeds?: string[],
  includeExpired?: boolean,
}

@remoteApp
export default class AppManager extends CallablePlugin {
  /** map App deployment seed to context */
  private appContexts: { [index: string]: any } = {}
  /** map appId to its seeds list */
  private appSeeds: { [index: string]: string[] } = {}
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
      // TODO: tssPlugin is not loaded yet, so the tssKey is null.
      if (!!this.tssPlugin.tssKey) {
        deploymentTssPublicKey = pub2json(this.tssPlugin.tssKey.publicKey!)
      }
    }
    try {
      const allAppContexts = [
        /** deployment app context */
        {
          appId: '1',
          appName: "deployment",
          isBuiltIn: true,
          seed: "1",
          rotationEnabled: false,
          // ttl: 0,
          party: {
            partners: this.collateralPlugin.filterNodes({isDeployer: true}).map(({id}) => id),
            t: this.collateralPlugin.TssThreshold,
            max: this.collateralPlugin.MaxGroupSize
          },
          publicKey: deploymentTssPublicKey,
        },
        /** other apps contexts */
        ...await AppContextModel.find({})
      ]

      allAppContexts.forEach(ac => {
        const {appId, seed} = ac;
        this.appContexts[seed] = ac;
        if(this.appSeeds[appId] === undefined)
          this.appSeeds[appId] = [seed]
        else
          this.appSeeds[appId].push(seed);
      })
      log('apps contexts loaded.')

      const allTssKeys = await AppTssConfigModel.find({});
      allTssKeys.forEach(key => {
        const {seed} = key;
        if (seed) {
          if(isAesEncrypted(key.keyShare))
            key.keyShare = aesDecrypt(key.keyShare, process.env.SIGN_WALLET_PRIVATE_KEY);
          this.appTssConfigs[seed] = key;
        }
      })
      log('apps tss keys loaded.')

      this.loading.resolve(true);
    }
    catch (e) {
      console.error(`core.AppManager.loadAppsInfo`, e);
    }
  }

  async onDeploymentTssKeyGenerate(tssKey) {
    const publicKey = TssModule.keyFromPublic(tssKey.publicKey);
    this.appContexts['1'].publicKey = pub2json(publicKey);
  }

  async saveAppContext(context: AppContext) {
    context = _.omit(context, ["_id"]) as AppContext;
    // @ts-ignore
    const oldDoc = await AppContextModel.findOne({seed: context.seed, appId: context.appId})
    if (oldDoc) {
      _.assign(oldDoc, context)
      oldDoc.dangerousAllowToSave = true
      await oldDoc.save()
      CoreIpc.fireEvent({type: "app-context:update", data: context})
      return oldDoc
    }
    else {
      let newContext = new AppContextModel(context)
      /**
       * Do not use this code in any other place
       * Call this method as the base method for saving AppContextModel.
       */
      newContext.dangerousAllowToSave = true
      await newContext.save()
      CoreIpc.fireEvent({type: "app-context:add", data: context})

      return newContext;
    }
  }

  async saveAppTssConfig(appTssConfig: AppTssConfig) {
    // @ts-ignore
    if (appTssConfig.keyShare) {
      let newConfig = new AppTssConfigModel(appTssConfig)
      /**
       * Do not use this code in any other place
       * Call this method as the base method for saving AppTssConfigModel.
       */
      newConfig.dangerousAllowToSave = true
      await newConfig.save()
      CoreIpc.fireEvent({
        type: "app-tss-key:add",
        data: newConfig
      })
    }

    // @ts-ignore
    const {appId, seed, keyGenRequest, publicKey} = appTssConfig;
    const context = await AppContextModel.findOne({seed}).exec();

    if(context.appId !== appId) {
      log.error(`AppManager.saveAppTssConfig appId mismatch %o`, {"appTssConfig.appId": appId, "context.appId": context.appId})
      return ;
    }

    // @ts-ignore
    context.keyGenRequest = keyGenRequest
    context.publicKey = publicKey
    context.dangerousAllowToSave = true
    await context.save();
    CoreIpc.fireEvent({
      type: "app-context:update",
      data: context,
    })
  }

  private async onAppContextAdd(doc) {
    log(`app context add %o`, doc)
    const {appId, seed} = doc;
    this.appContexts[seed] = doc;
    this.appSeeds[appId] = _.uniq([
      ...this.getAppSeeds(appId),
      seed
    ]) as string[]
  }

  private async onAppContextUpdate(doc) {
    log(`app context update %o`, doc)
    const {appId, seed} = doc;
    this.appContexts[seed] = doc;
    this.appSeeds[appId] = _.uniq([
      ...this.getAppSeeds(appId),
      seed
    ]) as string[]
  }

  private async onAppContextDelete(data: { contexts: any[] }) {
    try {
      const {contexts} = data
      if (!Array.isArray(contexts)) {
        log.error('missing appId/contexts.');
        return;
      }

      for(const context of contexts) {
        const {appId, seed} = context
        log(`pid[${process.pid}] app[${appId}] context deleting...`)
        this.appSeeds[appId] = this.appSeeds[appId].filter(s => s !== seed);

        if (!this.appContexts[seed]) {
          // log.error(`pid[${process.pid}] AppContextModel deleted but app data not found ${appId}`)
          return
        }
        delete this.appContexts[seed]
        delete this.appTssConfigs[seed]
        log(`app[${appId}] context deleted.`)
      }
    } catch (e) {
      log(`error when deleting app context %O`, e);
    }
  }

  private async onAppTssConfigAdd(doc) {
    log(`app tss config add %o`, _.omit(doc, ['keyShare']))
    if(isAesEncrypted(doc.keyShare))
      doc.keyShare = aesDecrypt(doc.keyShare, process.env.SIGN_WALLET_PRIVATE_KEY)
    this.appTssConfigs[doc.seed] = doc;
  }

  getAppDeploymentInfo(appId: string, seed: string): AppDeploymentInfo {
    const status = this.getAppDeploymentStatus(appId, seed);
    const DeployedTrueStatuses: AppDeploymentStatus[] = ['TSS_GROUP_SELECTED', "DEPLOYED", "PENDING"]
    const result: AppDeploymentInfo = {
      appId,
      seed,
      deployed: DeployedTrueStatuses.includes(status),
      status,
    }
    const context = seed ? this.getAppContext(appId, seed) : null
    if(context) {
      result.reqId = appId === '1' ? null : context.deploymentRequest.reqId
      result.contextHash = hashAppContext(context)
    }
    return result
  }

  async queryAndLoadAppContext(appId, options:AppContextQueryOptions={}): Promise<AppContext[]> {
    // TODO: query if the seed missed, check all usage

    const {
      seeds = [],
      includeExpired
    } = options

    /** Ignore query if found local. */
    const localContexts = this.getAppAllContext(appId);
    const localSeeds: string[] = localContexts.map(({seed}) => seed);
    if(localContexts.length > 0) {
      if(seeds.length > 0 && !seeds.find(seed => !localSeeds.includes(seed)))
        return localContexts;
    }

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
    const contextList: any[] = await Promise.any(
      candidateNodePeerIds.map(peerId => {
        return this.remoteCall(
          peerId,
          RemoteMethods.GetAppContext,
          {appId, options},
          {timeout: 5000}
        )
          .then(contexts => {
            if(!contexts || contexts.length < 1)
              throw `not found`
            return contexts;
          })
      })
    )
      .catch(e => []);
    if(contextList.length > 0) {
      log(`app context found.`)
      try {
        const savedContexts: any[] = [];
        for(const context of contextList) {
          const ctx:any = await this.saveAppContext(context)
          savedContexts.push(ctx);
        }
        return savedContexts;
      } catch (e) {
        log.error("error when storing context %o", e);
        return [];
      }
    }
    else {
      log.error('app context not found.')
      return []
    }
  }

  tssKeyQueryResult: {time: number, result: JsonPublicKey|null} = {time: 0, result: null}
  async queryAndLoadAppTssKey(appId: string, seed: string): Promise<JsonPublicKey|null> {
    const appContext = this.getAppContext(appId, seed)
    /** if context not found */
    if (!appContext)
      return null;

    const cacheIndex = `${appId}-${seed}`

    /** cache for 30 minutes */
    if (this.tssKeyQueryResult[cacheIndex]) {
      if (
        !!this.tssKeyQueryResult[cacheIndex].result ||
        Date.now() - this.tssKeyQueryResult[cacheIndex].time < 30e3
      )
        return this.tssKeyQueryResult[cacheIndex].result;
    }

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
          {appId, seed},
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
      this.tssKeyQueryResult[cacheIndex] = {
        time: Date.now(),
        result: null
      }
      return null;
    }

    const publicKey = TssModule.keyFromPublic(counts.max)
    const result = pub2json(publicKey)

    this.tssKeyQueryResult[cacheIndex] = {
      time: Date.now(),
      result: result
    }

    return result;
  }

  appIsDeployed(appId: string): boolean {
    return appId == '1' || this.getAppAllContext(appId).length > 0
  }

  appIsBuiltIn(appId: string): boolean {
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    return app.isBuiltInApp;
  }

  getAppSeeds(appId: string): string[] {
    return this.appSeeds[appId] || [];
  }

  getAppAllContext(appId: string, includeExpired:boolean=false): AppContext[] {
    const currentTime = getTimestamp()
    let contexts = this.getAppSeeds(appId)
      .map(seed => this.appContexts[seed]);
    if(!includeExpired) {
      contexts = contexts.filter(ctx => {
        return ctx.expiration > currentTime
      })
    }
    return contexts;
  }

  getAppContext(appId: string, seed: string) {
    return this.appContexts[seed];
  }

  async getAppContextAsync(appId: string, seed: string, tryFromNetwork:boolean=false): Promise<AppContext|undefined> {
    let context = this.appContexts[seed];
    if(!context && tryFromNetwork) {
      const contexts = await this.queryAndLoadAppContext(appId, {seeds: [seed], includeExpired: true})
      context = contexts.find(ctx => ctx.seed === seed)
    }
    return context;
  }

  /**
   By default returns oldest active context
   */
  getAppOldestContext(appId: string, includeExpired:boolean=false): AppContext|null {
    let contexts = this.getAppSeeds(appId)
      .map(seed => this.appContexts[seed])
    if(!includeExpired) {
      const now = getTimestamp()
      contexts = contexts.filter(ctx => ((ctx.expiration ?? Infinity) > now))
    }
    return contexts.reduce((first: AppContext, ctx: AppContext): AppContext => {
        if(!first)
          return ctx
        if((ctx.deploymentRequest?.data.timestamp ?? Infinity) < (first.deploymentRequest?.data.timestamp ?? Infinity))
          return ctx
        else
          return first
      }, null)
  }

  getAppLastContext(appId: string): AppContext {
    return this.getAppSeeds(appId)
      .map(seed => this.appContexts[seed])
      .reduce((last, ctx) => {
        if(!last)
          return ctx
        if(ctx.deploymentRequest.data.timestamp > last.deploymentRequest.data.timestamp)
          return ctx
        else
          return last
      }, null)
  }

  getAppDeploymentStatus(appId: string, seed: string): AppDeploymentStatus {
    let context: AppContext = this.getAppContext(appId, seed);

    let status: AppDeploymentStatus = "NEW"
    if (!!context) {
      status = "TSS_GROUP_SELECTED";

      if(appId === "1") {
        status = "DEPLOYED";
      }
      else {
        if (!!seed && !!context.publicKey) {
          status = "DEPLOYED";

          if (!!context.ttl) {
            const deploymentTime = context.deploymentRequest!.data.timestamp
            const pendingTime = deploymentTime + context.ttl;
            const currentTime = getTimestamp();

            if (currentTime > pendingTime) {
              status = "PENDING";
              if (context.expiration! < currentTime)
                status = "EXPIRED";
            }
          }
        }
      }
    }

    return status;
  }

  appHasTssKey(appId: string, seed: string): boolean {
    if (appId == '1') {
      const nodeInfo = this.collateralPlugin.currentNodeInfo!
      return nodeInfo?.isDeployer && !!this.tssPlugin.tssKey
    } else {
      return !!this.appTssConfigs[seed];
    }
  }

  getAppTssKey(appId: string, seed: string) {
    return this.appTssConfigs[seed];
  }

  /** useful when current node is not in the app party */
  publicKeyQueryTime = 0;
  async findAppPublicKeys(appId: string): Promise<MapOf<PublicKey>> {
    if(appId === '1') {
      const deploymentContextSeed = this.appSeeds["1"][0]
      const currentNode: MuonNodeInfo = this.collateralPlugin.currentNodeInfo!;
      if(currentNode.isDeployer) {
        if(this.tssPlugin.tssKey) {
          return {
            [deploymentContextSeed]:this.tssPlugin.tssKey.publicKey!
          };
        }
        else
          return {}
      }
      else {
        // TODO: needs refresh when deployment key reshared/recreated
        if(!this.deploymentPublicKey && this.publicKeyQueryTime + 2*60e3 < Date.now()) {
          this.publicKeyQueryTime = Date.now();

          const deployers: MuonNodeInfo[] = _.shuffle(this.collateralPlugin.filterNodes({isDeployer: true}));
          // @ts-ignore
          const publicKeyStr = await Promise.any(
            deployers.slice(0, 3).map(n => {
              return this.remoteCall(
                n.peerId,
                RemoteMethods.GetAppTss,
                {appId, seed: null},
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
        if(this.deploymentPublicKey) {
          return {
            [deploymentContextSeed]: this.deploymentPublicKey
          }
        }
        else
          return {}
      }
    }
    else {
      /** if key exist in current node */
      let appContests: any[] = this.getAppAllContext(appId)

      if (appContests.length < 1)
        appContests = await this.queryAndLoadAppContext(appId)

      return appContests.reduce((obj, ctx) => {
        obj[ctx.seed] = (ctx?.publicKey) ? TssModule.keyFromPublic(ctx.publicKey.encoded) : null;
        return obj
      }, {})
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
  async findNAvailablePartners(appId: string, contextSeed: string, searchList: string[], count: number, options: { timeout?: number, return?: string } = {}): Promise<string[]> {
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
      const status = this.getAppDeploymentStatus(appId, contextSeed)
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
        {appId, seed: contextSeed},
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

  async findOptimalAvailablePartners(appId: string, contextSeed: string, count: number, options: { timeout?: number, return?: string } = {}): Promise<string[]> {
    options = {
      //TODO: find N best partners instead of setting timeout
      timeout: 3000,
      return: 'id',
      ...options
    }
    const context = this.getAppContext(appId, contextSeed)
    if (!context)
      throw `app not deployed`;

    let peers = this.collateralPlugin.filterNodes({list: context.party.partners})
    log(`finding ${count} optimal available of ${context.appName} app partners ...`)

    let responseTimes = await Promise.all(
      peers.map(p => {
        return (
          p.wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__getAppPartyLatency({appId, seed: contextSeed}, this.collateralPlugin.currentNodeInfo)
          :
          this.remoteCall(
            p.peerId,
            RemoteMethods.GetAppPartyLatency,
            {appId, seed: contextSeed},
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
  async __getAppDeploymentInfo({appId, seed}): Promise<AppDeploymentInfo> {
    return this.getAppDeploymentInfo(appId, seed);
  }

  @remoteMethod(RemoteMethods.AppDeploymentInquiry)
  async __appDeploymentInquiry(appId, callerInfo) {
    return this.appIsDeployed(appId) ? "yes" : 'no';
  }

  /** return App all active context list */
  @remoteMethod(RemoteMethods.GetAppContext)
  async __getAppContext(data: {appId:string, options: AppContextQueryOptions}, callerInfo): Promise<any[]> {
    const {appId, options} = data;
    let contexts = this.getAppAllContext(appId, options.includeExpired)
    if(options?.seeds && options.seeds.length > 0){
      contexts = contexts.filter(ctx => options.seeds!.includes(ctx.seed))
    }
    return contexts;
  }

  @remoteMethod(RemoteMethods.GetAppTss)
  async __getAppTss(data: {appId: string, seed: string}, callerInfo) {
    const {appId, seed} = data;
    let publicKey:JsonPublicKey|null = null;

    if(appId === '1') {
      const currentNode: MuonNodeInfo = this.collateralPlugin.currentNodeInfo!
      publicKey = currentNode.isDeployer ? pub2json(this.tssPlugin.tssKey?.publicKey!) : null
    }
    else {
      publicKey = this.getAppTssKey(appId, seed)?.publicKey;
    }

    if (!publicKey)
      return null;

    return {
      appId,
      seed,
      // deploymentRequest: "",
      publicKey: publicKey.encoded,
    }
  }

  @remoteMethod(RemoteMethods.GetAppPartyLatency)
  async __getAppPartyLatency(data: { appId: string, seed: string }, callerInfo) {
    const {appId, seed} = data;
    if (!appId)
      throw `appId not defined`;
    const context = this.getAppContext(appId, seed)
    if (!context)
      throw `app not deployed`
    const peers = this.collateralPlugin.filterNodes({list: context.party.partners})
    const startTime = Date.now();
    const responses = await Promise.all(
      peers.map(p => {
        return (
          p.wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__getAppDeploymentInfo({appId, seed})
          :
          this.remoteCall(
            p.peerId,
            RemoteMethods.GetAppDeploymentInfo,
            {appId, seed},
            {timeout: 3000}
          )
        )
          .then(({status}) => {
            if (status !== 'DEPLOYED' && status !== "PENDING")
              return null;
            return Date.now() - startTime
          })
          .catch(e => null)
      })
    )
    return responses.reduce((obj, r, i) => (obj[peers[i].id]=r, obj), {});
  }
}
