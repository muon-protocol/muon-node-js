import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
import {AppDeploymentInfo, AppRequest, JsonPublicKey, MuonNodeInfo} from "../../common/types";
import {soliditySha3} from '../../utils/sha3.js'
import * as tssModule from '../../utils/tss/index.js'
import AppContextModel from "../../common/db-models/app-context.js"
import AppTssConfigModel from "../../common/db-models/app-tss-config.js"
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
  getNetworkConfigs() {
    return this.muon.configs.net;
  }

  @appApiMethod({})
  async selectRandomNodes(seed, t, n): Promise<MuonNodeInfo[]> {
    const availableNodes = await this.getAvailableNodes();
    if(availableNodes.length < t)
      throw `No enough nodes to select n subset`
    let nodesHash = availableNodes.map(node => {
      return {
        node,
        hash: soliditySha3([
          {t: 'uint256', v: seed},
          {t: 'uint64', v: node.id},
        ])!
      }
    });
    nodesHash.sort((a, b) => (a.hash > b.hash ? 1 : -1))
    return nodesHash.slice(0, n).map(i => i.node)
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
    return this.appManager.getAppDeploymentInfo(appId, context?.seed);
  }

  @appApiMethod({})
  async generateAppTss(appId, seed) {
    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App deployment info not found.`

    const generatorInfo = this.collateralPlugin.getNodeInfo(context.party.partners[0])!
    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return await this.__generateAppTss({appId, seed}, this.collateralPlugin.currentNodeInfo);
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
  async getAppTss(appId) {
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`
    const id = this.getAppTssKeyId(appId, context.seed)
    let key = await this.tssPlugin.getSharedKey(id)
    return key
  }

  @appApiMethod({})
  async findAndGetAppPublicKey(appId: string, seed: string, keyId: string): Promise<JsonPublicKey> {
    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    const appPartners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: context.party.partners
    })

    let responses = await Promise.all(appPartners.map(node => {
      if(node.id === this.collateralPlugin.currentNodeInfo?.id) {
        return this.__getAppPublicKey({appId, seed, keyId}, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(e.message)
            return 'error'
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
            return 'error'
          })
      }
    }))

    console.log({
      appId,
      seed,
      responses
    })

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

    await this.appManager.saveAppContext({
      appId,
      appName: this.muon.getAppNameById(appId),
      isBuiltIn: this.appManager.appIsBuiltIn(appId),
      seed,
      party: {
        t: result.tssThreshold,
        max: result.maxGroupSize,
        partners
      },
      rotationEnabled: result.rotationEnabled,
      ttl: result.ttl,
      deploymentRequest: request
    })

    return true
  }

  @appApiMethod({})
  async appDeploymentConfirmed(request: AppRequest, result) {
    /** store app context */
    const context = await this.writeAppContextIntoDb(request, result);

    // console.log(context);
    return true;
  }

  @appApiMethod({})
  async appKeyGenConfirmed(request) {
    const {
      data: {
        params: {appId},
        init: {id: keyId},
        result: {rotationEnabled, ttl, expiration, seed, publicKey},
      }
    } = request;
    console.log({rotationEnabled, ttl, expiration, seed, publicKey})

    /** check context exist */
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context) {
      throw `App deployment info not found to process tss KeyGen confirmation.`
    }

    const currentNode = this.collateralPlugin.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      /** store tss key */
      let key: DistributedKey = await this.tssPlugin.getSharedKey(keyId)!
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-${appId}-tss`)
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: pub2json(key.publicKey!),
        keyShare: bn2hex(key.share!),
        expiration,
      })
    }
    else {
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: request.data.init.publicKey,
        expiration,
      })
    }
  }

  @appApiMethod({})
  async undeployApp(appNameOrId: string) {
    // let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    // if(!app)
    //   throw `App not found by identifier: ${appNameOrId}`
    // const appId = app.APP_ID
    //
    // /** check app party */
    // const party = this.tssPlugin.getAppParty(appId)!;
    // if(!party)
    //   throw `App not deployed`;
    //
    // /** check app context */
    // let context = this.appManager.getAppContext(appId);
    // const deploymentTimestamp = context.deploymentRequest.data.timestamp;
    // const tssKeyAddress = context.publicKey?.address || null
    //
    // let deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.id)
    // const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: [...deployers, ...party.partners]})
    // log(`removing app contexts from nodes %o`, partnersToCall.map(p => p.id))
    // await Promise.all(partnersToCall.map(node => {
    //   if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
    //     return this.__undeployApp({appId, deploymentTimestamp}, this.collateralPlugin.currentNodeInfo)
    //       .catch(e => {
    //         log.error(`error when undeploy at current node: %O`, e)
    //         return e?.message || "unknown error occurred"
    //       });
    //   }
    //   else{
    //     return this.remoteCall(
    //       node.peerId,
    //       RemoteMethods.Undeploy,
    //       {appId, deploymentTimestamp}
    //     )
    //       .catch(e => {
    //         log.error(`error when undeploy at ${node.peerId}: %O`, e)
    //         return e?.message || "unknown error occurred"
    //       });
    //   }
    // }))
    //
    // this.broadcast({type: "undeploy", details: {
    //     appId,
    //     deploymentTimestamp
    // }})
  }

  @appApiMethod({})
  async getAppContext(appId, seed) {
    return this.appManager.getAppContext(appId, seed)
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

    const partyId = this.tssPlugin.getAppPartyId(context)

    await this.tssPlugin.createParty({
      id: partyId,
      t: context.party.t,
      partners: context.party.partners,//.map(wallet => this.collateralPlugin.getNodeInfo(wallet))
    });
    const party = this.tssPlugin.getAppParty(appId, seed);
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
    CoreIpc.fireEvent({type: 'app-context:delete', data: {contexts: deleteContextList}})
  }

  @remoteMethod(RemoteMethods.GetAppPublicKey)
  async __getAppPublicKey(data: {appId: string, seed: string, keyId}, callerInfo) {
    const {appId, seed, keyId} = data;

    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    let key = await this.tssPlugin.getSharedKey(keyId)
    // let key = await this.tssPlugin.getAppTssKey(appId, seed)
    if(!key)
      throw `App tss key not found.`

    return "0x" + key.publicKey!.encode("hex", true)
  }
}

export default System
