import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
import {AppDeploymentStatus, MuonNodeInfo} from "../../common/types";
import soliditySha3 from '../../utils/soliditySha3.js'
import * as tssModule from '../../utils/tss/index.js'
import AppContext from "../../common/db-models/AppContext.js"
import AppTssConfig from "../../common/db-models/AppTssConfig.js"
import * as NetworkIpc from '../../network/ipc.js'
import DistributedKey from "../../utils/tss/distributed-key.js";
import AppManager from "./app-manager.js";
import * as CoreIpc from '../ipc.js'
import useDistributedKey from "../../utils/tss/use-distributed-key.js";
import {logger} from '@libp2p/logger'
import {pub2json, timeout} from '../../utils/helpers.js'
import {bn2hex} from "../../utils/tss/utils.js";

const log = logger("muon:core:plugins:system");

const RemoteMethods = {
  InformAppDeployed: "informAppDeployed",
  GenerateAppTss: "generateAppTss",
  Undeploy: "undeploy",
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

  private getAvailableNodes(): MuonNodeInfo[] {
    const onlineNodes = this.collateralPlugin.filterNodes({isConnected: true, excludeSelf: true})
    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.PEER_ID!)
    return [
      currentNodeInfo!,
      ...onlineNodes
    ]
  }

  @broadcastHandler
  async __broadcastHandler(data, callerInfo: MuonNodeInfo) {
    // const {type, details} = data||{};
    // switch (type) {
    //   case 'undeploy': {
    //     const {appId} = details || {}
    //     this.__undeployApp(appId, callerInfo).catch(e => {})
    //     break;
    //   }
    // }
  }

  @appApiMethod()
  getNetworkInfo() {
    return {
      tssThreshold: this.collateralPlugin.networkInfo?.tssThreshold!,
      maxGroupSize: this.collateralPlugin.networkInfo?.maxGroupSize!,
    }
  }

  @appApiMethod({})
  selectRandomNodes(seed, t, n): MuonNodeInfo[] {
    const availableNodes = this.getAvailableNodes();
    if(availableNodes.length < t)
      throw `No enough nodes to select n subset`
    let nodesHash = availableNodes.map(node => {
      return {
        node,
        hash: soliditySha3([
          {t: 'uint256', v: seed},
          {t: 'uint64', v: node.id},
        ])
      }
    });
    nodesHash.sort((a, b) => (a.hash > b.hash ? 1 : -1))
    return nodesHash.slice(0, n).map(i => i.node)
  }

  getAppTssKeyId(appId, seed) {
    return `app-${appId}-tss-${seed}`
  }

  @appApiMethod({})
  async getAppStatus(appId: string): Promise<AppDeploymentStatus> {
    if(!this.appManager.appIsDeployed(appId))
      return {appId, deployed: false}
    if(!this.appManager.appHasTssKey(appId))
      return {appId, deployed: true, version: -1}
    const context = this.appManager.getAppContext(appId)
    return {
      appId,
      deployed: true,
      version: context.version,
      reqId: context.deploymentRequest.reqId,
    }
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
  async storeAppContext(request, result) {
    let {appId, seed} = request.data.params
    const partners = result.selectedNodes
    const context = await this.writeAppContextIntoDb(request, result);
    const allOnlineNodes = this.collateralPlugin.filterNodes({
      list: this.tssPlugin.tssParty?.partners,
      isOnline: true
    });

    let requestNonce: DistributedKey = await this.tssPlugin.getSharedKey(`nonce-${request.reqId}`)!

    if(request.owner === process.env.SIGN_WALLET_ADDRESS){

      const noncePartners = requestNonce.partners
      const noneInformedPartners = allOnlineNodes.filter(node => (noncePartners.indexOf(node.id) < 0))

      const informResponses = await Promise.all(noneInformedPartners.map(node => {
        if(node.wallet === process.env.SIGN_WALLET_ADDRESS)
          return "OK";
        // else
        return this.remoteCall(
          node.peerId,
          RemoteMethods.InformAppDeployed,
          request,
        )
          .catch(e => {
            console.log(`System.storeAppContext`, e)
            return 'error'
          })
      }));
    }

    // console.log(context);
    return true;
  }

  @appApiMethod({})
  async storeAppTss(appId, keyId) {
    // console.log(`System.storeAppTss`, {appId})

    /** check context exist */
    const context = await AppContext.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`

    /** check key not created before */
    const oldTssKey = await AppTssConfig.findOne({
      appId: appId,
      version: context.version,
    }).exec();
    if(oldTssKey)
      throw `App tss key already generated`

    /** store tss key */
    let key: DistributedKey = await this.tssPlugin.getSharedKey(keyId)!
    await useDistributedKey(key.publicKey!.encode('hex', true), `app-${appId}-tss`)
    await this.appManager.saveAppTssConfig({
      version: context.version,
      appId: appId,
      publicKey: pub2json(key.publicKey!),
      keyShare: bn2hex(key.share!),
    })
  }

  @appApiMethod({})
  async undeployApp(appNameOrId) {
    let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    if(!app)
      throw `App not found by identifier: ${appNameOrId}`
    const appId = app.APP_ID
    const party = this.tssPlugin.getAppParty(appId)!;
    if(!party)
      throw `App not deployed`;
    let deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.id)
    const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: [...deployers, ...party.partners]})
    log(`removing app contexts from nodes %o`, partnersToCall.map(p => p.id))
    await Promise.all(partnersToCall.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__undeployApp(appId, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(`error when undeploy at current node: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
      else{
        return this.remoteCall(
          node.peerId,
          RemoteMethods.Undeploy,
          appId
        )
          .catch(e => {
            log.error(`error when undeploy at ${node.peerId}: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
    }))

    this.broadcast({type: "undeploy", details: {appId}})
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

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.InformAppDeployed)
  async __informAppDeployed(request, callerInfo) {
    const {app, method} = request
    if(app !== 'deployment' || method !== 'deploy') {
      console.log("==== request ====", request);
      throw `Invalid deployment request`
    }

    const developmentApp = this.muon.getAppByName("deployment")
    await developmentApp.verifyRequestSignature(request);

    await this.writeAppContextIntoDb(request, request.data.result);

    return "OK"
  }

  @remoteMethod(RemoteMethods.GenerateAppTss)
  async __generateAppTss({appId}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});

    const context = await AppContext.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`
    const oldTssKey = await AppTssConfig.findOne({
      appId: context.appId,
      version: context.version
    }).exec();
    if(oldTssKey)
      throw `App tss key already generated`
    const partyId = this.tssPlugin.getAppPartyId(context.appId, context.version)

    await this.tssPlugin.createParty({
      id: partyId,
      t: context.party.t,
      partners: context.party.partners,//.map(wallet => this.collateralPlugin.getNodeInfo(wallet))
    });
    let party = this.tssPlugin.parties[partyId];
    if(!party)
      throw `Party not created`

    let key = await this.tssPlugin.keyGen(party, {timeout: 65e3, lowerThanHalfN: true})

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!)
    }
  }

  @remoteMethod(RemoteMethods.Undeploy)
  async __undeployApp(appId, callerInfo) {
    if(!callerInfo.isDeployer)
      throw `Only deployer can call this method`
    const app = this.appManager.getAppContext(appId)
    if(!app)
      throw `App not found`
    log(`deleting app from persistent db %s`, appId)
    await AppContext.deleteMany({appId});
    await AppTssConfig.deleteMany({appId});
    log(`deleting app from memory of all cluster %s`, appId)
    CoreIpc.fireEvent({type: 'app-context:delete', data: appId})
  }
}

export default System
