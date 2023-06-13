import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import TssPlugin from "./tss-plugin";
import {
  AppContext,
  AppDeploymentInfo,
  AppRequest,
  AppTssPublicInfo,
  JsonPublicKey,
  MuonNodeInfo
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
import {pub2json, timeout, uuid} from '../../utils/helpers.js'
import {bn2hex, toBN} from "../../utils/tss/utils.js";
import axios from 'axios'
import {MapOf} from "../../common/mpc/types";
import _ from 'lodash'
import BaseAppPlugin from "./base/base-app-plugin";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Rand = require('rand-seed').default;

const log = logger("muon:core:plugins:system");

const RemoteMethods = {
  GenerateAppTss: "generateAppTss",
  Undeploy: "undeploy",
  GetAppPublicKey: "getAppPubKey",
  StartAppTssReshare: "startAppTssReshare",
}

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  get tssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');
  }

  get appManager(): AppManager{
    return this.muon.getPlugin('app-manager');
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
        return item.isDeployer || (
          item.active &&
          item.tests.peerInfo &&
          item.uptime >= 5*60 &&
          item.tests.healthy &&
          item.tests.responseTimeRank <= 2
        )
      })
      availableIds = availables.map(p => `${p.id}`)
    }
    else {
      const delegateRoutingUrl = this.muon.configs.net.routing?.delegate;
      if(!delegateRoutingUrl)
        throw `delegate routing url not defined to get available list.`
      let response = await axios.get(`${delegateRoutingUrl}/onlines`).then(({data}) => data);
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

  @broadcastHandler
  async __broadcastHandler(data, callerInfo: MuonNodeInfo) {
    const {type, details} = data||{};
    switch (type) {
      case 'undeploy': {
        if(!callerInfo.isDeployer)
          return;
        const {appId, deploymentTimestamp} = details || {}
        this.__undeployApp({appId, deploymentTimestamp}, callerInfo)
          .catch(e => {})
        break;
      }
    }
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
    return this.appManager.getAppDeploymentInfo(appId, context!.seed);
  }

  @appApiMethod({})
  async generateAppTss(appId, seed) {
    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App deployment info not found.`

    const generatorId = await this.getFirstOnlinePartner(appId, seed);
    if(!generatorId)
      throw `key-gen starter node not online`

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

    const generatorId = await this.getFirstOnlinePartner(appId, seed);
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
  async getAppTss(appId): Promise<AppTssKey> {
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`
    const id = this.getAppTssKeyId(appId, context.seed)
    let key: AppTssKey = await this.tssPlugin.getSharedKey(id)
    return key
  }

  @appApiMethod({})
  async findAndGetAppTssPublicInfo(appId: string, seed: string, keyId: string): Promise<any> {
    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
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
    /** store app context */
    try {
      const context = await this.writeAppContextIntoDb(request, result);
    }
    catch (e) {
      log.error("error on calling appDeploymentConfirmed %O", e)
      throw e
    }

    return true;
  }

  @appApiMethod({})
  async appKeyGenConfirmed(request: AppRequest) {
    const {
      data: {
        params: {appId},
        init: {id: keyId},
        result: {rotationEnabled, ttl, expiration, seed, publicKey, polynomial},
      }
    } = request;

    /** check context exist */
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context) {
      throw `App deployment info not found to process tss KeyGen confirmation.`
    }

    const currentNode = this.nodeManager.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      /** The current node can store the key only when it has participated in key generation. */
      if(request.data.init.keyGenerators.includes(currentNode.id)) {
        /** store tss key */
        let key: AppTssKey = await this.tssPlugin.getSharedKey(keyId)!
        await useOneTime("key", key.publicKey!.encode('hex', true), `app-${appId}-tss`)
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
      /** Otherwise, it should recover it's key. */
      else {
        for(let numTry = 3 ; numTry > 0 ; numTry--) {
          /** Wait for a moment in order to let the other nodes get ready. */
          await timeout(10000);
          try {
            const recovered = await this.tssPlugin.checkAppTssKeyRecovery(appId, seed, true);
            if(recovered) {
              log(`tss key recovered successfully.`)
              break;
            }
          }
          catch (e) {
            log.error('error when recovering tss key. %O', e)
          }
        }
      }
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
        init: {id: reshareKeyId, keyGenerators},
        result: {expiration, seed, publicKey, polynomial: resharePolynomial, oldPolynomial},
      }
    } = request;

    /** check context exist */
    const context = await this.appManager.getAppContext(appId, seed);
    if(!context) {
      throw `App new context not found in app reshare confirmation.`
    }

    /** calculate new polynomial */
    const polynomial = this.appManager.mergeResharePolynomial(oldPolynomial, resharePolynomial, seed);

    const currentNode = this.nodeManager.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      /** The current node can reshare immediately if it is in the overlap partners. */
      if(
        /** Node has participated in reshare key generation */
        keyGenerators.includes(currentNode.id)
        /** Node has the old key */
        && this.appManager.appHasTssKey(appId, context.previousSeed)
      ) {
        let reshareKey: AppTssKey = await this.tssPlugin.getSharedKey(reshareKeyId)!
        /**
         Mark the reshareKey as used for app TSS key.
         If anyone tries to use this key for a different purpose, it will cause an error.
         Likewise, if this key has been used for another purpose before, it will throw an error again.
         */
        await useOneTime("key", reshareKey.publicKey!.encode('hex', true), `app-${appId}-reshare`)

        const oldKey: AppTssKey = this.tssPlugin.getAppTssKey(appId, context.previousSeed)!
        if (!oldKey)
          throw `The old party's TSS key was not found.`
        /**
         Mark the oldKey as used for app TSS key.
         If anyone tries to use this key for a different purpose, it will cause an error.
         Likewise, if this key has been used for another purpose before, it will throw an error again.
         */
        await useOneTime("key", oldKey.publicKey!.encode('hex', true), `app-${appId}-tss`)


        const appParty = this.tssPlugin.getAppParty(appId, seed)!
        if (!appParty)
          throw `App party not found`;

        const hexSeed = "0x" + BigInt(seed).toString(16)
        let share = oldKey.share!.add(reshareKey.share!).sub(toBN(hexSeed)).umod(TssModule.curve.n!);

        /** store tss key */
        await this.appManager.saveAppTssConfig({
          appId: appId,
          seed,
          keyGenRequest: request,
          publicKey,
          keyShare: bn2hex(share),
          polynomial,
          expiration,
        })
      }
      /** Otherwise, it has to wait and try to recover its key later. */
      else {
        log(`current node is not in the party overlap. it should recover the key.`)

        await this.appManager.saveAppTssConfig({
          appId: appId,
          seed,
          keyGenRequest: request,
          publicKey,
          polynomial,
          expiration,
        })

        for(let numTry=3 ; numTry > 0 ; numTry--) {
          await timeout(10000);
          try {
            const recovered = await this.tssPlugin.checkAppTssKeyRecovery(appId, seed, true);
            if(recovered) {
              log(`tss key recovered successfully.`)
              break;
            }
          }
          catch (e) {
            log.error('error when recovering tss key. %O', e)
          }
        }
      }
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
  async undeployApp(appNameOrId: string) {
    let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    if(!app)
      throw `App not found by identifier: ${appNameOrId}`
    const appId = app.APP_ID

    /** check app to be deployed */
    const seeds = this.appManager.getAppSeeds(appId);

    /** check app context */
    let allContexts: AppContext[] = this.appManager.getAppAllContext(appId, true);

    /** most recent deployment time */
    const deploymentTimestamp = allContexts
      .map(ctx => ctx.deploymentRequest?.data.timestamp!)
      .sort((a, b) => b - a)[0]

    let appPartners: string[] = [].concat(
      // @ts-ignore
      ...allContexts.map(ctx => ctx.party.partners),
    )

    let deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.id)

    const partnersToCall: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: [
        ...deployers,
        ...appPartners
      ]
    })
    log(`removing app contexts from nodes %o`, partnersToCall.map(p => p.id))
    await Promise.all(partnersToCall.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__undeployApp({appId, deploymentTimestamp}, this.nodeManager.currentNodeInfo)
          .catch(e => {
            log.error(`error when undeploy at current node: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
      else{
        return this.remoteCall(
          node.peerId,
          RemoteMethods.Undeploy,
          {appId, deploymentTimestamp},
          {timeout: 5000},
        )
          .catch(e => {
            log.error(`error when undeploy at ${node.peerId}: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
    }))

    this.broadcast({type: "undeploy", details: {
        appId,
        deploymentTimestamp
    }})
  }

  @appApiMethod({})
  async getAppContext(appId, seed, tryFromNetwork:boolean=false) {
    return this.appManager.getAppContextAsync(appId, seed, tryFromNetwork)
  }

  @appApiMethod()
  async getFirstOnlinePartner(appId: string, seed: string): Promise<string | undefined> {
    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `context not found`
    const currentNode = this.nodeManager.currentNodeInfo!;
    for(const id of context.party.partners) {
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

  @remoteMethod(RemoteMethods.GenerateAppTss)
  async __generateAppTss({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});
    if(!callerInfo.isDeployer)
      throw `Only deployers can call System.__generateAppTss`;

    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App deployment info not found.`

    /** check key not created before */
    if(context.publicKey?.encoded) {
      throw `App context already has key`
    }

    let key = await this.tssPlugin.keyGen({appId, seed}, {timeout: 65e3, lowerThanHalfN: true})

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!),
      generators: key.partners
    }
  }

  @remoteMethod(RemoteMethods.StartAppTssReshare)
  async __startAppTssReshare({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});
    if(!callerInfo.isDeployer)
      throw `Only deployers can call System.__startAppTssReshare`;

    const newContext: AppContext = this.appManager.getAppContext(appId, seed);
    if(!newContext)
      throw `App's new context not found.`

    const oldContext: AppContext = this.appManager.getAppContext(appId, newContext.previousSeed);
    if(!oldContext)
      throw `App's previous context not found.`

    log(`generating nonce for resharing app[${appId}] tss key`)
    const resharePartners = newContext.party.partners.filter(id => oldContext.party.partners.includes(id))
    let nonce = await this.tssPlugin.keyGen({appId, seed}, {
      id: `resharing-${uuid()}`,
      partners: _.uniq([
        this.nodeManager.currentNodeInfo!.id,
        ...resharePartners,
      ]),
      value: newContext.seed
    });
    log(`Nonce generated for resharing app[${appId}] tss key.`)

    return {
      id: nonce.id,
      /** The TSS key's publicKey will remain unchanged when it is reshared. */
      publicKey: oldContext.publicKey!.encoded,
      generators: nonce.partners
    }
  }

  @remoteMethod(RemoteMethods.Undeploy)
  async __undeployApp(data: {appId, deploymentTimestamp}, callerInfo) {
    if(!callerInfo.isDeployer)
      throw `Only deployer can call this method`;
    let {appId, deploymentTimestamp} = data;

    log(`deleting app from persistent db %s`, appId);
    /** get list of old contexts */
    const allContexts = await AppContextModel.find({appId})
    const deleteContextList: any[] = []

    for(let context of allContexts) {
      /** select context to be deleted */
      if(context.deploymentRequest.data.timestamp <= deploymentTimestamp) {
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

    const context:AppContext = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    let key: AppTssKey = await this.tssPlugin.getSharedKey(keyId)
    // let key = await this.tssPlugin.getAppTssKey(appId, seed)
    if(!key)
      throw `App tss key not found.`

    const keyJson = key.toJson()
    return {
      publicKey: keyJson.publicKey,
      polynomial: keyJson.polynomial
    }
  }

}

export default System
