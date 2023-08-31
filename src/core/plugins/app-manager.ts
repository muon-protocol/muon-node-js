import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod} from './base/app-decorators.js'
import TimeoutPromise from "../../common/timeout-promise.js";
import {
  AppContext,
  AppDeploymentInfo,
  AppDeploymentStatus,
  AppTssConfig,
  JsonPublicKey,
  MuonNodeInfo, NetConfigs, PolynomialInfoJson, WithRequired
} from "../../common/types";
import KeyManager from "./key-manager.js";
import BaseAppPlugin from "./base/base-app-plugin.js";
import NodeManagerPlugin from "./node-manager.js";
import * as CoreIpc from "../ipc.js";
import * as TssModule from '../../utils/tss/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import AppContextModel, {hash as hashAppContext} from "../../common/db-models/app-context.js"
import AppTssConfigModel from "../../common/db-models/app-tss-config.js"
import _ from 'lodash'
import {logger} from '@libp2p/logger'
import {getTimestamp, pub2json} from "../../utils/helpers.js";
import {findMinFullyConnectedSubGraph} from "../../common/graph-utils/index.js";
import {PublicKey} from "../../utils/tss/types";
import {aesDecrypt, isAesEncrypted} from "../../utils/crypto.js";
import {MapOf} from "../../common/mpc/types";
import * as PromiseLib from "../../common/promise-libs.js"
import {Mutex} from "../../common/mutex.js";
import {DEPLOYMENT_APP_ID, GENESIS_SEED} from "../../common/contantes.js";
import {RedisCache} from "../../common/redis-cache.js";

const log = logger('muon:core:plugins:app-manager')

const RemoteMethods = {
  GetAppDeploymentInfo: "get-app-deployment-info",
  GetAppContext: "get-app-context",
  GetAppTss: "get-app-tss",
  GetAppPartyLatency: "get-app-latency"
}

export type AppContextQueryOptions = {
  seeds?: string[],
  includeExpired?: boolean,
}

export type ContextFilterOptions = {
  appId?: string,
  deploymentStatus?: AppDeploymentStatus[],
  hasKeyGenRequest?: boolean,
  custom?: (ctx: AppContext) => boolean,
}

export type FindAvailableNodesOptions = {
  /** If it is set, target nodes will check the status of this app. */
  appId?: string,
  /** If the appId is set, the seed needs to be set. */
  seed?: string,
  /** If not enough nodes respond, the query will terminate after this timespan.*/
  timeout?: number,
  /** Determine which field of MuonNodeInfo should be returned as the response. The id field is the default value. */
  return?: string,
  /** ignore self and not include in result */
  excludeSelf?: boolean
}

@remoteApp
export default class AppManager extends CallablePlugin {
  /** map App deployment seed to context */
  private appContexts: MapOf<AppContext> = {}
  /** map appId to its seeds list */
  private appSeeds: MapOf<string[]> = {}
  private appTssConfigs: MapOf<AppTssConfig> = {}
  private loading: TimeoutPromise = new TimeoutPromise();
  private deploymentPublicKey: PublicKey | null = null;
  private readonly publicKeyCache:RedisCache = new RedisCache("app-seed-pub-key");

  private mutex:Mutex;

  async onInit() {
    this.mutex = new Mutex();
  }

  async onStart() {
    await super.onStart()

    this.muon.on("app-context:add", this.onAppContextAdd.bind(this))
    this.muon.on("app-context:update", this.onAppContextUpdate.bind(this))
    this.muon.on("app-context:delete", this.onAppContextDelete.bind(this))
    this.muon.on("app-tss-key:add", this.onAppTssConfigAdd.bind(this))

    this.muon.on("contract:node:add", this.onNodeAdd.bind(this));
    this.muon.on("contract:node:delete", this.onNodeDelete.bind(this));

    await this.loadAppsInfo()
  }

  onNodeAdd(nodeInfo: MuonNodeInfo) {
    if (!this.isLoaded())
      return;
    if (nodeInfo.isDeployer) {
      let deploymentContext = this.appContexts[GENESIS_SEED];
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
      let deploymentContext = this.appContexts[GENESIS_SEED];
      deploymentContext.party.partners = deploymentContext.party.partners.filter(id => id != nodeInfo.id)
    }
  }

  get keyManager(): KeyManager {
    return this.muon.getPlugin('key-manager');
  }

  get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  async loadAppsInfo() {
    log('loading apps info ...')
    await this.nodeManager.waitToLoad();
    const currentNode:MuonNodeInfo|undefined = this.nodeManager.currentNodeInfo;
    const netConfigs:NetConfigs = this.netConfigs;

    const allAppContexts: AppContext[] = [
      /** all deployers context */
      {
        appId: DEPLOYMENT_APP_ID,
        appName: "deployment",
        isBuiltIn: true,
        seed: GENESIS_SEED,
        rotationEnabled: true,
        ttl: netConfigs.tss.defaultTTL,
        pendingPeriod: netConfigs.tss.pendingPeriod,
        party: {
          partners: this.nodeManager.filterNodes({isDeployer: true}).map(({id}) => id),
          t: netConfigs.tss.threshold,
          max: netConfigs.tss.max
        },
      },
      /** other apps contexts */
      ...await AppContextModel.find({})
    ]

    allAppContexts.forEach(ctx => {
      const {appId, seed} = ctx;
      this.appContexts[seed] = ctx;
      if(this.appSeeds[appId] === undefined)
        this.appSeeds[appId] = [seed]
      else
        this.appSeeds[appId].push(seed);
      if(currentNode && ctx.party.partners.includes(currentNode.id) && (!ctx.expiration || Date.now() < ctx.expiration*1000)) {
        NetworkIpc.addContextToLatencyCheck(ctx).catch(e => {})
      }
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

  getNodeLastTimestamp(node: MuonNodeInfo): number|null {
    const max = Object.values(this.appContexts)
      .filter(ctx => ctx.appId!==DEPLOYMENT_APP_ID && ctx.party.partners.includes(node.id))
      .reduce((max, ctx)=>Math.max(max, ctx.deploymentRequest!.data.timestamp), 0);
    return max > 0 ? max : null
  }

  async saveAppContext(context: AppContext) {
    context = _.omit(context, ["_id"]) as AppContext;
    const lock = await this.mutex.lock(`ctx-update:${context.seed}`);
    try {
      // @ts-ignore
      const oldDoc = await AppContextModel.findOne({seed: context.seed, appId: context.appId})
      if (oldDoc) {
        if(oldDoc.keyGenRequest) {
          return;
        }
        _.assign(oldDoc, context)
        oldDoc.dangerousAllowToSave = true
        await oldDoc.save()
        CoreIpc.fireEvent({type: "app-context:update", data: context})
        NetworkIpc.fireEvent({type: "app-context:update", data: context})
        return oldDoc
      } else {
        let newContext = new AppContextModel(context)
        /**
         * Do not use this code in any other place
         * Call this method as the base method for saving AppContextModel.
         */
        newContext.dangerousAllowToSave = true
        await newContext.save()
        CoreIpc.fireEvent({type: "app-context:add", data: context})
        NetworkIpc.fireEvent({type: "app-context:add", data: context})

        return newContext;
      }
    }
    finally {
      await lock.release()
    }
  }

  async saveAppTssConfig(appTssConfig: WithRequired<AppTssConfig, "polynomial">) {
    // @ts-ignore
    if (appTssConfig.keyShare) {
      let newConfig = new AppTssConfigModel(appTssConfig)
      /**
       * Do not use this code in any other place
       * Call this method as the base method for saving AppTssConfigModel.
       */
      newConfig.dangerousAllowToSave = true
      await newConfig.save()
      CoreIpc.fireEvent({type: "app-tss-key:add", data: newConfig})
    }

    // @ts-ignore
    const {appId, seed, keyGenRequest, publicKey, polynomial} = appTssConfig;
    let context = await AppContextModel.findOne({seed}).exec();
    if(!context) {
      context = new AppContextModel(this.getAppContext(appId, seed))
    }

    if(context.appId !== appId) {
      log.error(`AppManager.saveAppTssConfig appId mismatch %o`, {"appTssConfig.appId": appId, "context.appId": context.appId})
      return ;
    }

    // @ts-ignore
    context.keyGenRequest = keyGenRequest
    context.publicKey = publicKey
    context.polynomial = polynomial
    context.dangerousAllowToSave = true
    await context.save();
    CoreIpc.fireEvent({type: "app-context:update", data: context,})
    NetworkIpc.fireEvent({type: "app-context:update", data: context,})
  }

  private async onAppContextAdd(ctx: AppContext) {
    log(`app context add %o`, ctx)
    const {appId, seed} = ctx;
    this.appContexts[seed] = ctx;
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
    const deployed:boolean = ['TSS_GROUP_SELECTED', "DEPLOYED", "PENDING"].includes(status);
    const result: AppDeploymentInfo = {
      appId,
      seed,
      deployed,
      hasKeyGenRequest: false,
      hasTssKey: this.appHasTssKey(appId, seed),
      status,
    }
    const context = seed ? this.getAppContext(appId, seed) : null
    if(context) {
      result.hasKeyGenRequest = !!context.keyGenRequest;
      result.reqId = appId === DEPLOYMENT_APP_ID ? undefined : context.deploymentRequest?.reqId;
      result.contextHash = hashAppContext(context);
    }
    return result
  }

  async queryAndLoadAppContext(appId, options:AppContextQueryOptions={}): Promise<AppContext[]> {
    // TODO: query if the seed missed, check all usage

    const {
      seeds = [],
      includeExpired
    } = options

    /** query only deployer nodes */
    const deployerNodes: string[] = this.nodeManager
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
    const appParty: MuonNodeInfo[] = this.nodeManager
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
    return appId == DEPLOYMENT_APP_ID || this.getAppAllContext(appId).length > 0
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
        return ctx.expiration === undefined || ctx.expiration > currentTime
      })
    }
    return contexts;
  }

  getAppContext(appId: string, seed: string) {
    return this.appContexts[seed];
  }

  getSeedContext(seed: string): AppContext | undefined {
    return this.appContexts[seed];
  }

  async getAppContextAsync(appId: string, seed: string, tryFromNetwork:boolean=false): Promise<AppContext|undefined> {
    let context:AppContext|undefined = this.appContexts[seed];
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
    return contexts.reduce((first: AppContext|null, ctx: AppContext): AppContext|null => {
        if(!first)
          return ctx
        if((ctx.deploymentRequest?.data.timestamp ?? Infinity) < (first.deploymentRequest?.data.timestamp ?? Infinity))
          return ctx
        else
          return first
      }, null)
  }

  getAppLastContext(appId: string): AppContext|undefined {
    return this.getAppSeeds(appId)
      .map(seed => this.appContexts[seed])
      .reduce((last:AppContext|undefined, ctx): AppContext|undefined => {
        if(!last)
          return ctx
        if(ctx.deploymentRequest!.data.timestamp > last.deploymentRequest!.data.timestamp)
          return ctx
        else
          return last
      }, undefined)
  }

  filterContexts(options: ContextFilterOptions={}): AppContext[] {
    const contexts : AppContext[] = !!options.appId
      ? this.getAppSeeds(options.appId).map(seed => this.appContexts[seed])
      : Object.values(this.appContexts);

    return contexts
      .filter(ctx => {
        const {appId, seed} = ctx;
        if(options.deploymentStatus && options.deploymentStatus.length>0) {
          if(!options.deploymentStatus.includes(this.getAppDeploymentStatus(appId, seed)))
            return false
        }
        if(options.hasKeyGenRequest !== undefined) {
          let hasKeyGenRequest = !!ctx.keyGenRequest
          if(options.hasKeyGenRequest !== hasKeyGenRequest)
            return false;
        }
        if(options.custom && !options.custom(ctx)) {
          return false;
        }
        return true
      })
  }

  isSeedRotated(seed: string): boolean {
    const context:AppContext|undefined = this.getSeedContext(seed);
    if(!context)
      return false;

    const deployTimestamp = context.deploymentRequest?.data.result.timestamp;
    const appContexts: AppContext[] = this.filterContexts({appId: context.appId})

    return !!appContexts.find(ctx => {
      return ctx.deploymentRequest?.data.result.timestamp > deployTimestamp
    });
  }

  isSeedReshared(seed: string): boolean {
    const context:AppContext|undefined = this.getSeedContext(seed);
    if(!context)
      return false;

    const deployTimestamp = context.deploymentRequest?.data.result.timestamp;
    const appContexts: AppContext[] = this.filterContexts({appId: context.appId, hasKeyGenRequest: true})

    return !!appContexts.find(ctx => {
      return ctx.deploymentRequest?.data.result.timestamp > deployTimestamp
    });
  }

  /**
   * This method returns an object that maps a context seed to the next rotated context seed.
   */
  getContextRotateMap(): MapOf<string> {
    return Object.values(this.appContexts)
      .reduce((obj, ctx: AppContext) => {
        let {seed, previousSeed} = ctx
        if(obj[seed] === undefined)
          obj[seed] = null
        if(previousSeed)
          obj[previousSeed] = seed;
        return obj;
      }, {})
  }

  getAppDeploymentStatus(appId: string, seed: string): AppDeploymentStatus {
    let context: AppContext = this.getAppContext(appId, seed);

    let status: AppDeploymentStatus = "NEW"
    if (!!context) {
      status = "TSS_GROUP_SELECTED";

      if(appId === DEPLOYMENT_APP_ID) {
        if(this.keyManager.isReady)
          status = "DEPLOYED";
      }
      else {
        if(!!context.publicKey) {
          status = "DEPLOYED";
        }

        if (status === "DEPLOYED") {
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

  /**
   * @return {number} - Deployment timestamp of most recent context
   */
  getLastContextTime(): number {
    return Object.values(this.appContexts).reduce((max, ctx) => {
      return Math.max(max, ctx.deploymentRequest?.data.timestamp || 0)
    }, 0);
  }

  /** Find all the contexts that include the current node and lack a key. */
  contextsWithoutKey(): AppContext[] {
    const currentNode: MuonNodeInfo = this.nodeManager.currentNodeInfo!;
    const pastTenMinutes: number = getTimestamp() - 10*60;

    const hasKey: MapOf<boolean> = Object.keys(this.appTssConfigs)
      .reduce((obj, seed) => (obj[seed]=true, obj), {});
    return Object.values(this.appContexts)
      /** Remove the contexts that have a key */
      .filter(({seed, appId}) => (appId!==DEPLOYMENT_APP_ID && !hasKey[seed]))
      .filter(ctx => {
        return ctx.party.partners.includes(currentNode.id)
          /** Remove new contexts. */
          && ctx.deploymentRequest!.data.timestamp < pastTenMinutes
      })
  }

  hasContext(ctx: AppContext): boolean {
    let existingCtx: AppContext = this.appContexts[ctx.seed];
    if(!existingCtx)
      return false;
    return (
      (!ctx.keyGenRequest && !existingCtx.keyGenRequest)
      ||
      (ctx.keyGenRequest?.data.result.seed === existingCtx.keyGenRequest?.data.result.seed)
    )
  }

  appHasTssKey(appId: string, seed: string): boolean {
    return !!this.appTssConfigs[seed];
  }

  getAppTssKey(appId: string, seed: string) {
    return this.appTssConfigs[seed];
  }

  /** useful when current node is not in the app party */
  async findAppPublicKey(appId: string, seed:string): Promise<PublicKey|null> {
    const cachedPubKey = await this.publicKeyCache.get(seed);
    if(cachedPubKey){
      return TssModule.keyFromPublic(cachedPubKey);
    }
    const currentNode: MuonNodeInfo = this.nodeManager.currentNodeInfo!;
    let ctx:AppContext = this.getAppContext(appId, seed);
    if(!ctx) {
      if (currentNode.isDeployer)
        return null
      const deployers: MuonNodeInfo[] = _.shuffle(this.nodeManager.filterNodes({isDeployer: true}));
      // @ts-ignore
      const publicKeyStr:string|null = await Promise.any(
        deployers.slice(0, 3).map(n => {
          return this.remoteCall(
            n.peerId,
            RemoteMethods.GetAppTss,
            {appId, seed},
            {timeout: 5000}
          )
            .then(result => {
              if(!result)
                throw `missing publicKey`
              return result.publicKey
            })
        })
      ).catch(e => null)
      if(!publicKeyStr)
        return null;
      await this.publicKeyCache.set(seed, publicKeyStr);
      return TssModule.keyFromPublic(publicKeyStr);
    }
    else{
      if(!ctx.publicKey?.encoded) {
        return null;
      }
      await this.publicKeyCache.set(seed, ctx.publicKey.encoded)
      return TssModule.keyFromPublic(ctx.publicKey.encoded);
    }
  }

  isLoaded() {
    return this.loading.isFulfilled;
  }

  waitToLoad() {
    return this.loading.promise;
  }

  /**
   * Finds available nodes from a given list. By default, it selects online nodes. Any node that responds will be selected.
   * If you pass {appId, seed} as the third param, only nodes that have this app's context and tss key will be selected.
   * @param searchList {string[]} - id/wallet/peerId list of nodes to check.
   * @param count {number} - enough count of results to resolve the promise.
   * @param options {FindAvailableNodesOptions} - Query options.
   * @return {string[]} - A list of the selected fields of available nodes (options.return specifies these items).
   */
  async findNAvailablePartners(searchList: string[], count: number, options: FindAvailableNodesOptions = {}): Promise<string[]> {
    options = {
      timeout: 15000,
      return: 'id',
      ...options
    }

    const {appId, seed} = options;

    let peers = this.nodeManager.filterNodes({list: searchList})
    log(`finding ${count} of ${searchList.length} available peer ...`)
    const selfIndex = peers.findIndex(p => p.peerId === process.env.PEER_ID!)

    let responseList: string[] = []
    let n = count;
    if (selfIndex >= 0) {
      peers = peers.filter((_, i) => (i !== selfIndex))
      if(options.excludeSelf !== true) {
        /** If the appId is not set, being online is enough to be considered as available. */
        if (!appId)
          responseList.push(this.currentNodeInfo![options!.return!]);
        else {
          const deploymentInfo = this.getAppDeploymentInfo(appId, seed!);
          if(deploymentInfo.deployed && deploymentInfo.hasTssKey) {
            responseList.push(this.currentNodeInfo![options!.return!]);
          }
        }
      }
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
        {appId, seed},
        {timeout: options!.timeout},
      )
        .then(({hasTssKey}) => {
          execTimes[i] = Date.now() - startTime
          if (!appId || hasTssKey) {
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

  /**
   * Finds an optimal sub-group of the app's party that has the minimum response latency between all partners.
   * @param appId {string} - The app whose party we want to find a sub-group of..
   * @param seed {string} - The seed of the app's context whose sub-group we want to find..
   * @param count {number} - Sub-group nodes count
   * @param options
   * @param options.timeout {number} - Amount of time in ms waiting for a node response.
   * @param options.return {number} - Determine which field of MuonNodeInfo should be returned as the response. The id field is the default value.
   * @return {string[]} - A list of the selected fields of available nodes (options.return specifies these items).
   */
  async findOptimalAvailablePartners(appId: string, seed: string, count: number, options: { timeout?: number, return?: string } = {}) {
    options = {
      //TODO: find N best partners instead of setting timeout
      timeout: 12000,
      return: 'id',
      ...options
    }
    const context = this.getAppContext(appId, seed)
    if (!context)
      throw `app not deployed`;

    let peers = this.nodeManager.filterNodes({list: context.party.partners})
    log(`finding ${count} optimal available of ${context.appName} app partners ...`)

    let responseTimes = await PromiseLib.resolveN(
      count,
      peers.map(p => {
        return (
          p.wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__getAppPartyLatency({appId, seed: seed}, this.nodeManager.currentNodeInfo)
          :
          this.remoteCall(
            p.peerId,
            RemoteMethods.GetAppPartyLatency,
            {appId, seed: seed},
            {timeout: options.timeout}
          )
        )
      }),
      true
    )
    responseTimes = responseTimes.reduce((obj, r, i) => (obj[peers[i].id]=r, obj), {});
    const graph = {}
    for(const [receiver, times] of Object.entries(responseTimes)) {
      if(!times)
        continue;
      for(const [sender, time] of Object.entries(times)) {
        if(typeof time !== 'number')
          continue ;
        if(!graph[sender])
          graph[sender] = {}
        graph[sender][receiver] = time;
      }
    }
    const minGraph = findMinFullyConnectedSubGraph(graph, count);
    return {
      availables: Object.keys(minGraph),
      graph,
      minGraph
    }
  }

  /**
   @return {AppContext[]} - returns all contexts that include the input node.
   */
  getNodeAllContexts(node: MuonNodeInfo): AppContext[] {
    return Object.values(this.appContexts)
      .filter((ctx:AppContext) => {
        return ctx.party.partners.includes(node.id)
      })
  }

  /**
   * Sort the AppContext list by deployment timestamp and return the `count` number of results.
   * @param fromTimestamp {number} - All context with deployment time grater than this value will be select
   * @param count {number} - The number of outputs that the user wants. The actual number of outputs may be higher than the value of this parameter.
   */
  getSortedContexts(fromTimestamp: number, count: number): AppContext[] {
    let list = Object.values(this.appContexts)
      .filter((ctx:AppContext) => {
        return !!ctx.deploymentRequest
          && ctx.deploymentRequest.data.timestamp >= fromTimestamp
      })
      .sort((a,b) => {
        // @ts-ignore
        const ta = a.deploymentRequest.data.timestamp, tb = b.deploymentRequest.data.timestamp;
        if(ta > tb)
          return 1
        else if(ta < tb)
          return -1
        else
          return 0;
      })

    if(list.length > count) {
      let lastItem = count-1;
      // @ts-ignore
      const cuttingEdgeTimestamp = list[lastItem].deploymentRequest.data.timestamp;
      // @ts-ignore
      while (list[lastItem] && list[lastItem+1].deploymentRequest.data.timestamp === cuttingEdgeTimestamp) {
        lastItem++;
      }
      list = list.slice(0, lastItem+1);
    }

    return list;
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.GetAppDeploymentInfo)
  async __getAppDeploymentInfo({appId, seed}): Promise<AppDeploymentInfo> {
    return this.getAppDeploymentInfo(appId, seed);
  }

  /** return App all active context list */
  @remoteMethod(RemoteMethods.GetAppContext)
  async __getAppContext(data: {appId:string, options: AppContextQueryOptions}, callerInfo): Promise<any[]> {
    const {appId, options} = data;
    let contexts = this.getAppAllContext(appId, options?.includeExpired)
    if(options?.seeds && options.seeds.length > 0){
      contexts = contexts.filter(ctx => options.seeds!.includes(ctx.seed))
    }
    /** Filter out the contexts where the caller node is not a member. */
    if(!callerInfo.isDeployer) {
      contexts = contexts.filter(ctx => ctx.party.partners.includes(callerInfo.id));
    }

    return contexts;
  }

  @remoteMethod(RemoteMethods.GetAppTss)
  async __getAppTss(data: {appId: string, seed: string}, callerInfo) {
    const {appId, seed} = data;

    let publicKey:JsonPublicKey|null = this.getAppTssKey(appId, seed)?.publicKey;

    if (!publicKey)
      return null;

    return {
      appId,
      seed,
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
      throw `App not deployed`

    let {deployed, hasTssKey} = this.getAppDeploymentInfo(appId, seed);
    if(deployed && hasTssKey) {
      return await NetworkIpc.getAppLatency(appId, seed)
    }
    else
      throw `App not deployed`

  }
}
