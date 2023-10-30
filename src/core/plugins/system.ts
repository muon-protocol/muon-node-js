import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import KeyManager from "./key-manager.js";
import {
  AppContext,
  AppDeploymentInfo,
  AppRequest,
  AppTssPublicInfo,
  JsonPublicKey,
  MuonNodeInfo, NetConfigs, Party
} from "../../common/types";
import * as TssModule from '../../utils/tss/index.js'
import AppContextModel from "../../common/db-models/app-context.js"
import AppTssConfigModel from "../../common/db-models/app-tss-config.js"
import AppTssKey from "../../utils/tss/app-tss-key.js";
import AppManager from "./app-manager.js";
import * as CoreIpc from '../ipc.js'
import * as NetworkIpc from '../../network/ipc.js'
import {useOneTime} from "../../utils/tss/use-one-time.js";
import {logger} from '@libp2p/logger'
import {getTimestamp, pub2json, timeout, uuid} from '../../utils/helpers.js'
import {bn2hex, toBN} from "../../utils/tss/utils.js";
import axios from 'axios'
import {MapOf} from "../../common/mpc/types";
import _ from 'lodash'
import BaseAppPlugin from "./base/base-app-plugin";

import { createRequire } from "module";
import ReshareCronJob from "./cron-jobs/reshare-cron-job";
import {muonSha3} from "../../utils/sha3.js";
import * as crypto from "../../utils/crypto.js";
import {DEPLOYMENT_APP_ID, GENESIS_SEED, NODE_ROLE_DEPLOYER} from "../../common/contantes.js";
import {APP_STATUS_EXPIRED} from "../constants.js";
import {onlyDeployers, coreRemoteMethodSchema as methodSchema} from "../remotecall-middlewares.js";
import { AppContextSchema, PartySchema } from '../../common/ajv-schemas.js';
const require = createRequire(import.meta.url);
const Rand = require('rand-seed').default;

const log = logger("muon:core:plugins:system");

const RemoteMethods = {
  InitDeploymentContext: "initDeploymentContext",
  StoreGenesisKey: 'storeGenesisKey',
  GenerateAppTss: "generateAppTss",
  GetAppPublicKey: "getAppPubKey",
  StartAppTssReshare: "startAppTssReshare",
  DeploymentAppStatus: "deploymentAppStatus",
}

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  get keyManager(): KeyManager{
    return this.muon.getPlugin('key-manager');
  }

  get appManager(): AppManager{
    return this.muon.getPlugin('app-manager');
  }

  @appApiMethod()
  async initDeploymentContext(context: AppContext) {
    const app:BaseAppPlugin = this.muon.getAppById(context.appId);
    context.appName = app.APP_NAME!;
    context.isBuiltIn = app.isBuiltInApp;

    const partners:MuonNodeInfo[] = [
      ...this.nodeManager.filterNodes({isDeployer: true}),
      ...this.nodeManager.filterNodes({list: context.party.partners}),
    ]

    const currentNode:MuonNodeInfo|undefined = this.currentNodeInfo;
    if(!currentNode)
      throw `Current node is not added to network.`

    return Promise.all(
      partners.map(p => {
        if(p.id === currentNode.id) {
          return this.__initDeploymentContext(context, currentNode)
            .catch(e => e.message)
        }
        return this.remoteCall(
          p.peerId,
          RemoteMethods.InitDeploymentContext,
          context,
          {timeout: 5000},
        )
          .catch(e => e.message);
      })
    )
  }

  @appApiMethod()
  async initializeGenesisKey() {
    const currentNode:MuonNodeInfo = this.nodeManager.currentNodeInfo!
    if(!currentNode || !currentNode.isDeployer)
      throw `Only deployers can initialize the network.`

    const netConfigs: NetConfigs = this.muon.configs.net;

    const deployers: MuonNodeInfo[] = this.nodeManager.filterNodes({isDeployer: true});

    const responses = await Promise.all(
      deployers.map(n => {
        if(n.id === currentNode.id) {
          return this.__deploymentAppStatus(null, currentNode);
        }
        else {
          return this.remoteCall(
            n.peerId,
            RemoteMethods.DeploymentAppStatus,
            null,
            {timeout: 2000}
          )
            .catch(e => null)
        }
      })
    )

    let withoutKeyCount = responses.filter(s => (!!s && (!s.hasTssKey || s.status === APP_STATUS_EXPIRED))).length;
    let withKeyCount = responses.filter(s => (!!s && s.hasTssKey && s.status !== APP_STATUS_EXPIRED)).length

    log('initializing genesis key %o', {withoutKeyCount, withKeyCount})

    if(withKeyCount>netConfigs.tss.threshold)
      throw `There is t deployer node with deployment keys`;
    if(withKeyCount > 0)
      throw `Some nodes has deployment key`;
    if(withoutKeyCount<netConfigs.tss.threshold)
      throw `No enough online deployers to create the key.`;

    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers.map(n => n.peerId),
      Math.ceil(this.netConfigs.tss.threshold*1.2),
      {timeout: 10000}
    )
    if(onlineDeployers.length < this.netConfigs.tss.threshold) {
      log(`Its need ${this.netConfigs.tss.threshold} deployer to create deployment tss but only ${onlineDeployers.length} are available`)
      throw `No enough online deployers to create the deployment tss key.`
    }
    log(`Deployers %o are available to create deployment tss`, onlineDeployers)

    let key: AppTssKey = await this.keyManager.keyGen(
      {appId: "1", seed: GENESIS_SEED},
      {
        partners: deployers.map(n => n.id),
        dealers: onlineDeployers,
        lowerThanHalfN: true,
        usage: {type: "app", seed: GENESIS_SEED},
      }
    )

    let callResult = await Promise.all(deployers.map(({wallet, peerId}) => {
      return (
        wallet === process.env.SIGN_WALLET_ADDRESS
          ?
          this.__storeGenesisKey({key: key.id}, this.nodeManager.currentNodeInfo)
          :
          this.remoteCall(
            peerId,
            RemoteMethods.StoreGenesisKey,
            {
              key: key.id,
            },
            {timeout: 120e3}
            // {taskId: `keygen-${key.id}`}
          )
      )
        .catch(e=>{
          console.log("RemoteCall.StoreGenesisKey", e);
          return false
        });
    }))

    if (callResult.filter(r => r === true).length+1 < this.netConfigs.tss.threshold)
      throw `Tss creation failed.`

    return _.pick(key.toJson(), ["publicKey", "polynomial", "partners"]);
  }

  private async getAvailableNodes(): Promise<MuonNodeInfo[]> {
    const externalOnlineList = this.muon.configs.net.nodes?.onlineList;
    let availableIds: string[] = [];

    const isDeployer: {[index: string]: string} = this.nodeManager
      .filterNodes({isDeployer: true})
      .map(node => node.id)
      .reduce((obj, current) => (obj[current]=true, obj), {});

    if(externalOnlineList){
      let response = await axios.get(externalOnlineList).then(({data}) => data);
      let availables = response.result.filter(item => {
        /** active nodes that has uptime more than 1 hour */
        // return item.isDeployer || (item.active && item.status_is_ok && parseInt(item.uptime) > 60*60)
        return item.roles.includes(NODE_ROLE_DEPLOYER) || (
          item.active 
          && item.tests.peerInfo 
          && item.uptime >= 5*60 
          && item.tests.healthy 
          // && item.tests.responseTimeRank <= 2
        )
      })
      availableIds = availables.map(p => `${p.id}`)
    }
    else {
      const delegateRoutingUrls = this.muon.configs.net.routing?.delegate;
      if(!Array.isArray(delegateRoutingUrls) || delegateRoutingUrls.length < 1)
        throw `delegate routing url not defined to get available list.`
      // @ts-ignore
      let response = await Promise.any(
        delegateRoutingUrls.map(url => {
          return axios.get(`${url}/onlines`)
        })
      ).then(({data}) => data);
      let thresholdTimestamp = Date.now() - 60*60*1000
      let availables = response.filter(item => {
        /** active nodes that has uptime more than 1 hour */
        return isDeployer[item.id] || (item.timestamp > thresholdTimestamp)
      })
      availableIds = availables.map(p => p.id)
    }

    const onlineNodes = this.nodeManager.filterNodes({list: availableIds, excludeSelf: true})
    const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.PEER_ID!)
    return [
      currentNodeInfo!,
      ...onlineNodes
    ]
  }

  @appApiMethod()
  async getAvailableDeployers(): Promise<string[]> {
    return this.getAvailableNodes()
      .then(list => {
        return list.filter(n => n.isDeployer)
          .map(n => n.id);
      })
  }

  @appApiMethod()
  getNetworkConfigs() {
    return this.muon.configs.net;
  }

  @appApiMethod({})
  async selectRandomNodes(seed, t, n): Promise<MuonNodeInfo[]> {
    const availableNodes = await this.getAvailableNodes();
    if(availableNodes.length < t){
      throw "Insufficient nodes for subnet creation";
    }
    if(availableNodes.length < n) {
      n = availableNodes.length;
    }

    // nodeId => MuonNodeInfo
    let availableNodesMap: MapOf<MuonNodeInfo> = {};
    availableNodes.map(node => availableNodesMap[node.id]=node);

    const rand = new Rand(seed);
    let selectedNodes: MuonNodeInfo[] = [], rndNode:number = 0;

    /** The available list may not be sorted by id */
    let maxId: number = availableNodes.reduce((max, n) => Math.max(max, parseInt(n.id)), 0)

    const selectedIds: string[] = []
    while(selectedIds.length != n){
      rndNode = Math.floor(rand.next() * maxId) + 1;

      // Only active ids will be added to selectedNodes.
      // The process works fine even if the available
      // nodes change during deployment, as long as the
      // updated nodes are not in the selected list.
      if(availableNodesMap[rndNode]){
        const currentId = availableNodesMap[rndNode].id;
        if(!selectedIds.includes(currentId)) {
          selectedIds.push(currentId);
          selectedNodes.push(availableNodesMap[rndNode]);
        }
      }
    }
    return selectedNodes;
  }

  getAppTssKeyId(appId, seed) {
    return `app-${appId}-tss-${seed}`
  }

  @appApiMethod({})
  getAppDeploymentInfo(appId: string, seed: string): AppDeploymentInfo {
    return this.appManager.getAppDeploymentInfo(appId, seed)
  }

  @appApiMethod({})
  getAppLastDeploymentInfo(appId: string): AppDeploymentInfo {
    const context = this.appManager.getAppLastContext(appId)
    // @ts-ignore
    return this.appManager.getAppDeploymentInfo(appId, context?.seed);
  }

  @appApiMethod({})
  async generateAppTss(appId, seed) {
    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App onboarding info not found.`
    const {partners} = context.party

    const generatorId = await this.getFirstOnlinePartner(partners);
    if(!generatorId) {
      let isOnline:any = await Promise.all(
        context.party.partners.map(id => NetworkIpc.isNodeOnline(id).catch(e => e.message))
      )
      isOnline = isOnline.reduce((obj, t, i) => (obj[partners[i]]=t, obj), {})
      const debug = {
        generatorId: generatorId || null,
        isOnline
      }
      throw {message: `key-gen starter node is not online`, ...debug}
    }

    const generatorInfo: MuonNodeInfo = this.nodeManager.getNodeInfo(generatorId)!;

    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return await this.__generateAppTss({appId, seed}, this.nodeManager.currentNodeInfo);
    }
    else {
      // TODO: if partner is not online
      return await this.remoteCall(
        generatorInfo.peerId,
        RemoteMethods.GenerateAppTss,
        {appId, seed},
        {timeout: 65e3}
      )
    }
  }

  @appApiMethod({})
  async reshareAppTss(appId, seed) {
    const newContext = this.appManager.getAppContext(appId, seed);
    if(!newContext)
      throw `App's new context not found.`
    const oldContext = this.appManager.getAppContext(appId, newContext.previousSeed!);
    if(!oldContext)
      throw `App's old context not found.`

    const dealers: string[] = newContext.party.partners.filter(id => oldContext.party.partners.includes(id));
    const readyDealers = await this.appManager.findNAvailablePartners(
      dealers,
      dealers.length,
      {appId, seed: oldContext.seed, return: "id"},
    );
    // const generatorId = dealers.filter(id => readyDealers.includes(id))[0];
    const generatorId = _.shuffle(dealers.filter(id => readyDealers.includes(id)))[0];
    if(!generatorId)
      throw `key-gen starter node not online`

    const generatorInfo: MuonNodeInfo = this.nodeManager.getNodeInfo(generatorId)!;

    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return this.__startAppTssReshare({appId, seed}, this.nodeManager.currentNodeInfo);
    }
    else {
      // TODO: if partner is not online
      return this.remoteCall(
        generatorInfo.peerId,
        RemoteMethods.StartAppTssReshare,
        {appId, seed},
        {timeout: 65e3}
      )
    }
  }

  @appApiMethod({})
  async validateShareProofs(polynomial: string[], shareProofs: MapOf<string>): Promise<boolean> {
    const netConfigs:NetConfigs = this.netConfigs;
    const threshold = polynomial.length
    if(Object.keys(shareProofs).length < netConfigs.tss.minShareProof * threshold) {
      throw `Share proof count is lower than the minimum required count.`
    }
    /** nodes must sign hash of publicKey */
    const keyPublicHash = muonSha3(polynomial[0]);
    const poly = polynomial.map(pub => TssModule.keyFromPublic(pub));
    for(const [nodeId, signature] of Object.entries(shareProofs)) {
      const nodesPublicKey = TssModule.calcPolyPoint(nodeId, poly);
      const nodesAddress = TssModule.pub2addr(nodesPublicKey);
      if (crypto.recover(keyPublicHash, signature) !== nodesAddress) {
        return false;
      }
    }
    return true;
  }

  @appApiMethod({})
  async findAndGetAppTssPublicInfo(appId: string, seed: string, keyId: string): Promise<any> {
    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App onboarding info not found.`
    const appPartners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: context.party.partners
    })

    let responses: (AppTssPublicInfo|null)[] = await Promise.all(appPartners.map(node => {
      if(node.id === this.nodeManager.currentNodeInfo?.id) {
        return this.__getAppPublicKey({appId, seed, keyId}, this.nodeManager.currentNodeInfo)
          .catch(e => {
            log.error(e.message)
            return null;
          })
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.GetAppPublicKey,
          {appId, seed, keyId}
        )
          .catch(e => {
            log.error(e.message)
            return null
          })
      }
    }))

    let counts: MapOf<number> = {}, max:AppTssPublicInfo|null=null;
    for(const info of responses) {
      if(info === null || (info.polynomial && info.publicKey !== info.polynomial.Fx[0]))
        continue
      if(!counts[info.publicKey])
        counts[info.publicKey] = 1
      else
        counts[info.publicKey] ++;
      if(!max || counts[info.publicKey] > counts[max.publicKey])
        max = info;
    }
    if(!max || counts[max.publicKey] < context.party.t) {
      throw 'public key not found';
    }

    const publicKey = TssModule.keyFromPublic(max.publicKey, "hex")

    return {
      publicKey: pub2json(publicKey),
      polynomial: max.polynomial
    }
  }

  async writeAppContextIntoDb(request, result) {
    let {method} = request
    let {appId} = request.data.params
    let {previousSeed, seed} = request.data.result
    const partners = result.selectedNodes

    await this.appManager.saveAppContext({
      appId,
      appName: this.muon.getAppNameById(appId),
      isBuiltIn: this.appManager.appIsBuiltIn(appId),
      previousSeed: method === 'tss-rotate' ? previousSeed : undefined,
      seed,
      party: {
        t: result.tssThreshold,
        max: result.maxGroupSize,
        partners,
      },
      rotationEnabled: result.rotationEnabled,
      ttl: result.ttl,
      pendingPeriod: result.pendingPeriod,
      expiration: result.expiration,
      deploymentRequest: request
    })

    return true
  }

  @appApiMethod({})
  async appDeploymentConfirmed(request: AppRequest, result) {
    const {
      method,
      data: {
        params: {appId},
        init: {key: {id: keyId}},
        result: {selectedNodes, expiration, previousSeed, seed, publicKey, polynomial},
      }
    } = request; 
    
  
    await this.appManager.saveAppContext({
      appId,
      appName: this.muon.getAppNameById(appId),
      isBuiltIn: this.appManager.appIsBuiltIn(appId),
      previousSeed: method === 'reshare' ? previousSeed : undefined,
      seed,
      party: {
        t: result.tssThreshold,
        max: result.maxGroupSize,
        partners: selectedNodes,
      },
      rotationEnabled: result.rotationEnabled,
      ttl: result.ttl,
      pendingPeriod: result.pendingPeriod,
      expiration: result.expiration,
      deploymentRequest: request,
      publicKey,
      polynomial,
    })
    
    const currentNode = this.nodeManager.currentNodeInfo!;
    if(selectedNodes.includes(currentNode.id)) {
      // TODO: check context has key or not ?
      let key: AppTssKey = await this.keyManager.getSharedKey(keyId, 20e3, {type: "app", seed})!
      /** store tss key */
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: pub2json(key.publicKey!),
        keyShare: bn2hex(key.share!),
        polynomial,
        expiration,
      })
    }

    return true;
  }

  @appApiMethod({})
  async appKeyGenConfirmed(request: AppRequest) {
    const {
      data: {
        params: {appId},
        init: {id: keyId},
        result: {expiration, seed, polynomial},
      }
    } = request;

    /** check context exist */
    const context = this.appManager.getAppContext(appId, seed);
    if(!context) {
      throw `App deployment info not found to process tss KeyGen confirmation.`
    }

    const currentNode = this.nodeManager.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?
      let key: AppTssKey = await this.keyManager.getSharedKey(keyId, undefined, {type: "app", seed})!
      /** store tss key */
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: pub2json(key.publicKey!),
        keyShare: bn2hex(key.share!),
        polynomial,
        expiration,
      })
    }
    else {
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: request.data.init.publicKey,
        polynomial,
        expiration,
      })
    }
  }

  @appApiMethod({})
  async appReshareConfirmed(request: AppRequest) {
    const {
      data: {
        params: {appId},
        init: {key: {id: reshareKeyId}},
        result: {expiration, seed, publicKey, polynomial},
      }
    } = request;

    /** check context exist */
    const context = await this.appManager.getAppContext(appId, seed);
    if(!context) {
      throw `App onboarding context not found in app reshare confirmation.`
    }
    

    const currentNode = this.nodeManager.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      let reshareKey: AppTssKey = await this.keyManager.getSharedKey(reshareKeyId, undefined, {type: "app", seed})!;
      let keyShare:string|undefined;
      /**
       prevent storing wrong share.
       if the key's polynomial is not as same as the context polynomial, the key will be ignored.
       */
      if(reshareKey.toJson().polynomial!.Fx.join(',') === polynomial.Fx.join(',')) {
        keyShare = bn2hex(reshareKey.share!)
      }
      /**
       Mark the reshareKey as used for app TSS key.
       If anyone tries to use this key for a different purpose, it will cause an error.
       Likewise, if this key has been used for another purpose before, it will throw an error again.
       */
      await useOneTime("key", reshareKey.publicKey!.encode('hex', true), `app-${appId}-tss`)

      const appParty = this.appManager.getAppParty(appId, seed)!
      if (!appParty)
        throw `App party not found`;

      /** store tss key */
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey,
        keyShare,
        polynomial,
        expiration,
      })
    }
    else {
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey,
        polynomial,
        expiration,
      })
    }
  }

  @appApiMethod({})
  async getReshareLeader(): Promise<MuonNodeInfo|undefined> {
    const resharePlugin: ReshareCronJob = this.muon.getPlugin('reshare-cj');
    const id: string = resharePlugin.getLeader()
    return this.nodeManager.getNodeInfo(id);
  }

  @appApiMethod({})
  async undeployApp(appNameOrId: string) {
    let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    if(!app)
      throw `App not found by identifier: ${appNameOrId}`
    const appId = app.APP_ID

    /** check app context */
    let allContexts: AppContext[] = this.appManager.getAppAllContext(appId, true);

    /** most recent deployment time */
    const currentTime = getTimestamp();
    const deploymentTimestamp = allContexts
      .map(ctx => ctx.deploymentRequest?.data.timestamp! || currentTime)
      .sort((a, b) => b - a)[0]

    log(`undeploying ${appId}`)
    return this.__undeployApp({appId, deploymentTimestamp}, this.nodeManager.currentNodeInfo)
      .catch(e => {
        log.error(`error when undeploy at current node: %O`, e)
        return e?.message || "unknown error occurred"
      });
  }
  
  @appApiMethod({})
  async getAppContext(appId, seed, tryFromNetwork:boolean=false) {
    // return this.appManager.getAppContextAsync(appId, seed, tryFromNetwork)
    return this.appManager.getAppContext(appId, seed)
  }

  @appApiMethod()
  async getFirstOnlinePartner(checkList: string[]): Promise<string | undefined> {
    const currentNode = this.nodeManager.currentNodeInfo!;
    for(const id of checkList) {
      const isOnline = id === currentNode.id || (await NetworkIpc.isNodeOnline(id))
      if(isOnline) {
        return id
      }
    }
    return undefined;
  }

  @appApiMethod({})
  getAppTTL(appId: number): number {
    const tssConfigs = this.muon.configs.net.tss;
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    return app.TTL ?? tssConfigs.defaultTTL;
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.InitDeploymentContext, onlyDeployers, methodSchema(AppContextSchema))
  async __initDeploymentContext(ctx: AppContext, callerInfo: MuonNodeInfo): Promise<string> {
    this.appManager.onboardAppContext(ctx);
    return "OK"
  }

  /**
   * Node with ID:[1] inform other nodes that tss creation completed.
   *
   * @param data
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<boolean>}
   * @private
   */
  @remoteMethod(RemoteMethods.StoreGenesisKey)
  async __storeGenesisKey(data: {key: string}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    let {key: keyId} = data
    // let party = this.getParty(partyId)
    let key: AppTssKey = await this.keyManager.getSharedKey(keyId, undefined, {type: "app", seed: GENESIS_SEED})!;
    if (!key)
      throw {message: 'System.StoreGenesisKey: key not found.'};
    if(callerInfo.id == this.netConfigs.defaultLeader && await this.keyManager.isNeedToCreateKey()) {
      const currentNode = this.nodeManager.currentNodeInfo!;

      const context = this.appManager.getSeedContext(GENESIS_SEED)!;
      await this.appManager.saveAppContext({
        ...context,
        publicKey: pub2json(key.publicKey),
        polynomial: key.toJson().polynomial,
      })
      if(context.party.partners.includes(currentNode.id)) {
        // TODO: check context has key or not ?
        /** store tss key */
        await this.appManager.saveAppTssConfig({
          appId: DEPLOYMENT_APP_ID,
          seed: GENESIS_SEED,
          publicKey: pub2json(key.publicKey!),
          keyShare: bn2hex(key.share!),
          polynomial: key.toJson().polynomial!
        })
      }
      return true;
    }
    else{
      throw "Not permitted to create tss key"
    }
  }

  @remoteMethod(RemoteMethods.GenerateAppTss, onlyDeployers)
  async __generateAppTss({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});

    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App onboarding info not found.`

    let key = await this.keyManager.keyGen(
      {appId, seed},
      {
          timeout: 65e3,
          lowerThanHalfN: true,
          usage: {type: "app", seed}
        }
      )

    const shareProofs = await this.keyManager.getKeyShareProofs(
      seed,
      key.partners,
      key.id,
      key.polynomial!.Fx
    )

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!),
      polynomial: key.toJson().polynomial,
      generators: key.partners,
      shareProofs,
    }
  }

  @remoteMethod(RemoteMethods.StartAppTssReshare)
  async __startAppTssReshare({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});
    if(!callerInfo.isDeployer)
      throw `Only deployers can call System.__startAppTssReshare`;

    const newContext: AppContext|undefined = this.appManager.getAppContext(appId, seed);
    if(!newContext)
      throw `App's onboarding context not found.`

    const oldContext: AppContext = this.appManager.getAppContext(appId, newContext.previousSeed!);
    if(!oldContext)
      throw `App's previous context not found.`

    log(`redistributing app[${appId}] tss key`)
    let keyRedist = await this.keyManager.redistributeKey(
      {appId, seed: oldContext.seed},
      {appId, seed: newContext.seed},
      {
        id: `resharing-${uuid()}`,
        usage: {type: "app", seed}
      }
    );
    log(`Key redistribution done for app[${appId}] tss key.`)

    const shareProofs = await this.keyManager.getKeyShareProofs(
      seed,
      newContext.party.partners,
      keyRedist.id,
      keyRedist.polynomial!.Fx
    )

    return {
      id: keyRedist.id,
      /** The TSS key's publicKey will remain unchanged when it is reshared. */
      publicKey: oldContext.publicKey!.encoded,
      generators: keyRedist.partners,
      shareProofs,
    }
  }

  async __undeployApp(data: {appId, deploymentTimestamp}, callerInfo) {
    let {appId, deploymentTimestamp} = data;

    log(`deleting app from persistent db %s`, appId);
    /** get list of old contexts */
    const allContexts = await AppContextModel.find({appId})
    const deleteContextList: any[] = []

    for(let context of allContexts) {
      /** select context to be deleted */
      if(!context.deploymentRequest || context.deploymentRequest.data.timestamp <= deploymentTimestamp) {
        deleteContextList.push(context)
      }
    }
    const seedsToDelete = deleteContextList.map(c => c.seed)
    await AppContextModel.deleteMany({
      $or: [
        /** for backward compatibility. old keys may not have this field. */
        {seed: { "$exists" : false }},
        {seed: {$in: seedsToDelete}},
      ]
    });

    await AppTssConfigModel.deleteMany({
      appId,
      $or: [
        /** for backward compatibility. old keys may not have this field. */
        {seed: { "$exists" : false }},
        {seed: {$in: seedsToDelete}},
      ]
    });
    log(`deleting app from memory of all cluster %s`, appId)
    CoreIpc.fireEvent({type: "app-context:delete", data: {contexts: deleteContextList}})
    NetworkIpc.fireEvent({type: "app-context:delete", data: {contexts: deleteContextList}})
  }


  @remoteMethod(RemoteMethods.GetAppPublicKey)
  async __getAppPublicKey(data: {appId: string, seed: string, keyId}, callerInfo): Promise<AppTssPublicInfo> {
    const {appId, seed, keyId} = data;

    const context:AppContext|undefined = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    let key: AppTssKey = await this.keyManager.getSharedKey(keyId, undefined, {type: "app", seed});
    // let key = await this.keyManager.getAppTssKey(appId, seed)
    if(!key)
      throw `App tss key not found.`

    const keyJson = key.toJson()
    return {
      publicKey: keyJson.publicKey,
      polynomial: keyJson.polynomial
    }
  }

  @remoteMethod(RemoteMethods.DeploymentAppStatus)
  async __deploymentAppStatus(data, callerInfo: MuonNodeInfo): Promise<AppDeploymentInfo> {
    let ctx = this.appManager.getAppLastContext(DEPLOYMENT_APP_ID)
    return this.appManager.getAppDeploymentInfo(DEPLOYMENT_APP_ID, ctx?.seed ?? GENESIS_SEED);
  }

}

export default System
