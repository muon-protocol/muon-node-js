import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
import {AppDeploymentInfo, AppRequest, JsonPublicKey, MuonNodeInfo} from "../../common/types";
import {soliditySha3} from '../../utils/sha3.js'
import * as tssModule from '../../utils/tss/index.js'
import AppContext from "../../common/db-models/AppContext.js"
import AppTssConfig from "../../common/db-models/AppTssConfig.js"
import * as NetworkIpc from '../../network/ipc.js'
import DistributedKey from "../../utils/tss/distributed-key.js";
import AppManager from "./app-manager.js";
import * as CoreIpc from '../ipc.js'
import {useOneTime} from "../../utils/tss/use-one-time.js";
import {logger} from '@libp2p/logger'
import {pub2json, timeout} from '../../utils/helpers.js'
import {bn2hex} from "../../utils/tss/utils.js";
import axios from 'axios'
import {MapOf} from "../../common/mpc/types";
import BaseAppPlugin from "./base/base-app-plugin";
import Rand, {PRNG} from 'rand-seed';

const log = logger("muon:core:plugins:system");

const RemoteMethods = {
  GenerateAppTss: "generateAppTss",
  Undeploy: "undeploy",
  GetAppPublicKey: "getAppPubKey",
}

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
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

    const isDeployer: {[index: string]: string} = this.collateralPlugin
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

    const onlineNodes = this.collateralPlugin.filterNodes({list: availableIds, excludeSelf: true})
    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.PEER_ID!)
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
  getNetworkInfo() {
    return {
      tssThreshold: this.collateralPlugin.networkInfo?.tssThreshold!,
      maxGroupSize: this.collateralPlugin.networkInfo?.maxGroupSize!,
    }
  }

  @appApiMethod({})
  async selectRandomNodes(seed, t, n): Promise<MuonNodeInfo[]> {
    const availableNodes = await this.getAvailableNodes();
    if(availableNodes.length < t){
      throw "Insufficient nodes for subnet creation";
    }

    // nodeId => true
    let availableNodesMap = {};
    availableNodes.map(node => availableNodesMap[node.id]=node);

    const rand = new Rand(seed);
    let selectedNodes: MuonNodeInfo[] = [], rndNode:number = 0;

    let maxId = parseInt(availableNodes[availableNodes.length-1].id);
    while(selectedNodes.length != n){
      rndNode = Math.floor(rand.next() * maxId);
      
      // Only active ids will be added to selectedNodes.
      // The process works fine even if the available 
      // nodes change during deployment, as long as the
      // updated nodes are not in the selected list.
      if(availableNodesMap[rndNode]){
        selectedNodes.push(availableNodesMap[rndNode]);
      }
    }
    return selectedNodes;
  }

  getAppTssKeyId(appId, seed) {
    return `app-${appId}-tss-${seed}`
  }

  @appApiMethod({})
  getAppDeploymentInfo(appId: string): AppDeploymentInfo {
    return this.appManager.getAppDeploymentInfo(appId);
  }

  @appApiMethod({})
  async genAppTss(appId) {
    const context = this.appManager.getAppContext(appId);
    if(!context)
      throw `App deployment info not found.`

    const generatorInfo = this.collateralPlugin.getNodeInfo(context.party.partners[0])!
    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return await this.__generateAppTss({appId}, null);
    }
    else {
      // TODO: if partner is not online
      return await this.remoteCall(
        generatorInfo.peerId,
        RemoteMethods.GenerateAppTss,
        {appId},
        {timeout: 65e3}
      )
    }
  }

  @appApiMethod({})
  async getAppTss(appId) {
    const context = await AppContext.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`
    const id = this.getAppTssKeyId(appId, context.seed)
    let key = await this.tssPlugin.getSharedKey(id)
    return key
  }

  @appApiMethod({})
  async findAndGetAppPublicKey(appId, keyId): Promise<JsonPublicKey> {
    const context = this.appManager.getAppContext(appId)
    if(!context)
      throw `App deployment info not found.`
    const appPartners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: context.party.partners
    })

    let responses = await Promise.all(appPartners.map(node => {
      if(node.id === this.collateralPlugin.currentNodeInfo?.id) {
        return this.__getAppPublicKey({appId, keyId}, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(e.message)
            return 'error'
          })
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.GetAppPublicKey,
          {appId, keyId}
        )
          .catch(e => {
            log.error(e.message)
            return 'error'
          })
      }
    }))

    let counts: MapOf<number> = {}, max:string|null=null;
    for(const str of responses) {
      if(str === 'error')
        continue
      if(!counts[str])
        counts[str] = 1
      else
        counts[str] ++;
      if(!max || counts[str] > counts[max])
        max = str;
    }
    if(!max || counts[max] < context.party.t) {
      throw 'public key not found';
    }

    const publicKey = tssModule.keyFromPublic(max.replace("0x", ""), "hex")

    return pub2json(publicKey)
  }

  @appApiMethod({})
  async getDistributedKey(keyId) {
    let key = await this.tssPlugin.getSharedKey(keyId)
    if(!key)
      throw `Distributed key not found.`
    return key
  }

  async writeAppContextIntoDb(request, result) {
    let {appId, seed} = request.data.params
    const partners = result.selectedNodes
    const version = 0;
    const deployTime = request.confirmedAt * 1000

    await this.appManager.saveAppContext({
      version, // TODO: version definition
      appId,
      appName: this.muon.getAppNameById(appId),
      isBuiltIn: this.appManager.appIsBuiltIn(appId),
      seed,
      party: {
        t: result.tssThreshold,
        max: result.maxGroupSize,
        partners
      },
      deploymentRequest: request,
      deployTime
    })

    return true
  }

  @appApiMethod({})
  async storeAppContext(request: AppRequest, result) {
    /** store app context */
    const context = await this.writeAppContextIntoDb(request, result);

    // console.log(context);
    return true;
  }

  @appApiMethod({})
  async appKeyGenConfirmed(request) {
    const {data: {params: {appId}, init: {id: keyId}}} = request;

    /** check context exist */
    const context = await AppContext.findOne({appId}).exec();
    if(!context) {
      throw `App deployment info not found to process tss KeyGen confirmation.`
    }

    const currentNode = this.collateralPlugin.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      /** check key not created before */
      if(context.publicKey?.encoded) {
        throw `App context already has key`
      }

      /** store tss key */
      let key: DistributedKey = await this.tssPlugin.getSharedKey(keyId)!
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-${appId}-tss`)
      await this.appManager.saveAppTssConfig({
        version: context.version,
        appId: appId,
        context: context._id,
        publicKey: pub2json(key.publicKey!),
        keyShare: bn2hex(key.share!),
      })
    }
    else {
      await this.appManager.saveAppTssConfig({
        version: context.version,
        appId: appId,
        context: context._id,
        publicKey: request.data.init.publicKey
      })
    }
  }

  @appApiMethod({})
  async undeployApp(appNameOrId) {
    let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    if(!app)
      throw `App not found by identifier: ${appNameOrId}`
    const appId = app.APP_ID

    /** check app party */
    const party = this.tssPlugin.getAppParty(appId)!;
    if(!party)
      throw `App not deployed`;

    /** check app context */
    let context = this.appManager.getAppContext(appId);
    const deploymentTimestamp = context.deploymentRequest.data.timestamp;
    const tssKeyAddress = context.publicKey?.address || null

    let deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.id)
    const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: [...deployers, ...party.partners]})
    log(`removing app contexts from nodes %o`, partnersToCall.map(p => p.id))
    await Promise.all(partnersToCall.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__undeployApp({appId, deploymentTimestamp}, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(`error when undeploy at current node: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
      else{
        return this.remoteCall(
          node.peerId,
          RemoteMethods.Undeploy,
          {appId, deploymentTimestamp}
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
  async getAppContext(appId) {
    let contexts = await AppContext.find({
      appId
    });
    return contexts[0]
  }

  @appApiMethod({})
  async generateReshareNonce(appId, reqId) {
    let key = await this.tssPlugin.keyGen(undefined, {id: `reshare-${appId}-${reqId}`, value: '1'})
    /**
     * Ethereum addresses
     * [0]: 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
     * [1]: 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF
     * [2]: 0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69
     */
    console.log({
      expected: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
      calculated: tssModule.pub2addr(key.publicKey!)
    })
    return key.publicKey
  }

  @appApiMethod({})
  async generateTssKeyBetweenPartners(t, partners: string[]) {
    const partyId = soliditySha3(partners.map(v => ({t:'string', v})))!

    await this.tssPlugin.createParty({id: partyId, t, partners});
    let party = this.tssPlugin.parties[partyId];
    if(!party)
      throw `Party not created`

    let key = await this.tssPlugin.keyGen(party, {timeout: 65e3, lowerThanHalfN: true})

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!)
    }
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.GenerateAppTss)
  async __generateAppTss({appId}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});

    const context = await AppContext.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`

    /** check key not created before */
    if(context.publicKey?.encoded) {
      throw `App context already has key`
    }

    const partyId = this.tssPlugin.getAppPartyId(context.appId, context.version)

    await this.tssPlugin.createParty({
      id: partyId,
      t: context.party.t,
      partners: context.party.partners,//.map(wallet => this.collateralPlugin.getNodeInfo(wallet))
    });
    const party = this.tssPlugin.getAppParty(appId);
    if(!party)
      throw `Party not created`

    let key = await this.tssPlugin.keyGen(party, {timeout: 65e3, lowerThanHalfN: true})

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!),
      generators: key.partners
    }
  }

  @remoteMethod(RemoteMethods.Undeploy)
  async __undeployApp(data: {appId, deploymentTimestamp}, callerInfo) {
    if(!callerInfo.isDeployer)
      throw `Only deployer can call this method`
    let {appId, deploymentTimestamp} = data;

    log(`deleting app from persistent db %s`, appId);
    /** get list of old contexts */
    const allContexts = await AppContext.find({appId})
    const deleteContextList: any[] = []
    const deleteKeyList: any[] = [];

    for(let context of allContexts) {
      /** select context to be deleted */
      if(context.deploymentRequest.data.timestamp <= deploymentTimestamp) {
        deleteContextList.push(context)
        /** add context key into delete list */
        if(context.publicKey?.encoded)
          deleteKeyList.push(context.publicKey?.encoded)
      }
    }
    await AppContext.deleteMany({
      "deploymentRequest.reqId": {$in: deleteContextList.map(c => c.deploymentRequest.reqId)}
    });

    await AppTssConfig.deleteMany({
      appId,
      "publicKey.encoded": {$in: deleteKeyList},
    });
    log(`deleting app from memory of all cluster %s`, appId)
    CoreIpc.fireEvent({type: 'app-context:delete', data: {appId, contexts: deleteContextList}})
  }

  @remoteMethod(RemoteMethods.GetAppPublicKey)
  async __getAppPublicKey(data: {appId: string, keyId: string}, callerInfo) {
    const {appId, keyId} = data;

    const context = this.appManager.getAppContext(appId)
    if(!context)
      throw `App deployment info not found.`
    let key = await this.tssPlugin.getSharedKey(keyId)
    if(!key)
      throw `App tss key not found.`

    return "0x" + key.publicKey!.encode("hex", true)
  }
}

export default System
