import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, appApiMethod} from './base/app-decorators'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
import {MuonNodeInfo} from "../../common/types";
const soliditySha3 = require('../../utils/soliditySha3');
const AppContext = require("../../gateway/models/AppContext")
const AppTssConfig = require("../../gateway/models/AppTssConfig")
import * as NetworkIpc from '../../networking/ipc'
import DistributedKey from "./tss-plugin/distributed-key";
const { timeout } = require('../../utils/helpers')
const { promisify } = require("util");

const RemoteMethods = {
  AppStatus: "appStatus",
  InformAppDeployed: "informAppDeployed",
  GenerateAppTss: "generateAppTss",
}

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get CollateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  get TssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');
  }

  getAvailableNodes(): MuonNodeInfo[] {
    const peerIds = Object.keys(this.TssPlugin.availablePeers)
    return [
      {
        wallet: process.env.SIGN_WALLET_ADDRESS!,
        peerId: process.env.PEER_ID!
      },
      ...peerIds.map(peerId => {
        return {
          wallet: this.CollateralPlugin.getPeerWallet(peerId),
          peerId
        }
      })
    ]
  }

  @appApiMethod({})
  selectRandomNodes(seed, n): MuonNodeInfo[] {
    const availableNodes = this.getAvailableNodes();
    if(availableNodes.length < n)
      throw `No enough nodes to select n subset`
    let nodesHash = availableNodes.map(node => {
      return {
        node,
        hash: soliditySha3([
          {t: 'uint256', v: seed},
          {t: 'address', v: node.wallet},
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
  async getAppStatus(appId) {
    const remoteNodes = Object.values(this.TssPlugin.tssParty!.onlinePartners);
    const callResult = await Promise.all(remoteNodes.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS)
        return this.__returnAppStatus(appId)
      return this.remoteCall(
        node.peerId,
        RemoteMethods.AppStatus,
        appId,
        {timeout: 15000}
      )
        .catch(e => "error")
    }));
    return callResult
  }

  @appApiMethod({})
  async newAppTss(appId, partners: MuonNodeInfo[], t, seed) {
    const partyId = `app-${appId}-party`;
    await this.TssPlugin.createParty({id: partyId, t, partners});
    let party = this.TssPlugin.parties[partyId];
    if(!party)
      throw `Party not created`
    let key = await this.TssPlugin.keyGen(party, {id: this.getAppTssKeyId(appId, seed)})
    return key
  }

  @appApiMethod({})
  async genAppTss(appId, seed) {
    const context = await AppContext.findOne({appId, seed}).exec();
    if(!context)
      throw `App deployment info not found.`
    if(context.party.partners[0] === process.env.SIGN_WALLET_ADDRESS){
      return await this.__generateAppTss({appId, seed}, null);
    }
    else {
      const peerId = this.CollateralPlugin.getWalletPeerId(context.party.partners[0])
      return await this.remoteCall(
        peerId,
        RemoteMethods.GenerateAppTss,
        {appId, seed}
      )
    }
  }

  @appApiMethod({})
  async appDKGen(appId, partners: MuonNodeInfo[], t, seed) {
    const partyId = `app-${appId}-party`;
    await this.TssPlugin.createParty({id: partyId, t, partners});
    let party = this.TssPlugin.parties[partyId];
    if(!party)
      throw `Party not created`
    let key = await this.TssPlugin.keyGen(party, {id: this.getAppTssKeyId(appId, seed)})
    return key
  }

  @appApiMethod({})
  async getAppTss(appId, seed) {
    const id = this.getAppTssKeyId(appId, seed)
    let key = this.TssPlugin.getSharedKey(id)
    return key
  }

  async writeAppContextIntoDb(request, result) {
    let {appId, seed} = request.data.params
    const partners = result.selectedNodes
    const version = 0;
    const deployTime = request.confirmedAt * 1000

    await AppContext.findOneAndUpdate({
      version,
      appId,
    },{
      version, // TODO: version definition
      appId,
      seed,
      party: {
        t: this.CollateralPlugin.TssThreshold,
        max: partners.length,
        partners
      },
      deployTime
    },{
      upsert: true,
      useFindAndModify: false,
    })

    return true
  }

  @appApiMethod({})
  async storeAppContext(request, result) {
    let {appId, seed} = request.data.params
    const partners = result.selectedNodes
    const context = await this.writeAppContextIntoDb(request, result);
    const allOnlineNodes = Object.values(this.TssPlugin.tssParty?.onlinePartners!);

    let requestNonce: DistributedKey = this.TssPlugin.getSharedKey(request.reqId)!

    // TODO: replace leader returned wallet with request owner. request owner most inform other parties.
    let informer = await NetworkIpc.getGroupExecutor(requestNonce.partners, "inform-app-deployment")
    if(informer === process.env.SIGN_WALLET_ADDRESS){
      // let keyGenExecutor = await NetworkIpc.getGroupExecutor(partners, "app-tss-keygen")
      // console.log({keyGenExecutor})

      const noncePartners = requestNonce.partners
      const noneInformedPartners = allOnlineNodes.map(n => n.wallet).filter(w => (noncePartners.indexOf(w) < 0))

      const informResponses = await Promise.all(noneInformedPartners.map(wallet => {
        if(wallet === process.env.SIGN_WALLET_ADDRESS)
          return this.__informAppDeployed(request, null)
            .catch(e => {
              console.log(`System.storeAppContext`, e)
              return 'error'
            });
        // else
        return this.remoteCall(
          this.CollateralPlugin.getWalletPeerId(wallet),
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
  async storeAppTss(appId, seed) {
    console.log(`System.storeAppTss`, {appId, seed})

    /** check context exist */
    const context = await AppContext.findOne({appId, seed}).exec();
    if(!context)
      throw `App deployment info not found.`

    /** check key not created before */
    const oldTssKey = await AppTssConfig.findOne({
      owner: process.env.SIGN_WALLET_ADDRESS,
      context: context._id,
    }).exec();
    if(oldTssKey)
      throw `App tss key already generated`

    /** store tss key */
    const id = this.getAppTssKeyId(appId, seed);
    let key: DistributedKey = this.TssPlugin.getSharedKey(id)!
    const tssConfig = new AppTssConfig({
      owner: process.env.SIGN_WALLET_ADDRESS,
      context: context._id,
      publicKey: {
        address: key.address,
        encoded: '0x' + key.publicKey?.encodeCompressed('hex'),
        x: '0x' + key.publicKey?.getX().toBuffer('be',32).toString('hex'),
        yParity: key.publicKey?.getY().isEven() ? 0 : 1,
      },
      keyShare: key.share?.toBuffer('be', 32).toString('hex'),
    })
    await tssConfig.save();
    // console.log(key)
  }

  @appApiMethod({})
  async getAppContext(appId) {
    let contexts = await AppContext.find({
      owner: process.env.SIGN_WALLET_ADDRESS,
      appId
    });
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.AppStatus)
  async __returnAppStatus(appId) {
    if(!this.TssPlugin.appHasTssKey(appId))
      return "NotDeployed"
    return "Deployed"
  }

  @remoteMethod(RemoteMethods.InformAppDeployed)
  async __informAppDeployed(request, callerInfo) {
    const {app, method} = request
    if(app !== 'deployment' || method !== 'deploy') {
      console.log("==== request ====", request);
      throw `Invalid deployment request`
    }

    const muonApp = this.muon._apps['deployment']
    await muonApp.verifyRequestSignature(request);

    await this.writeAppContextIntoDb(request, request.data.result);

    return "OK"
  }

  @remoteMethod(RemoteMethods.GenerateAppTss)
  async __generateAppTss({appId, seed}, callerInfo) {
    console.log(`System.__generateAppTss`, {appId, seed});

    const context = await AppContext.findOne({appId, seed}).exec();
    if(!context)
      throw `App deployment info not found.`
    const oldTssKey = await AppTssConfig.findOne({
      owner: process.env.SIGN_WALLET_ADDRESS,
      context: context._id,
    }).exec();
    if(oldTssKey)
      throw `App tss key already generated`
    const partyId = `app-${appId}-party`;
    console.log("========= creating party ... =========")
    await this.TssPlugin.createParty({
      id: partyId,
      t: this.TssPlugin.TSS_THRESHOLD,
      partners: context.party.partners.map(wallet => ({
        wallet,
        peerId: this.CollateralPlugin.getWalletPeerId(wallet)
      }))
    });
    let party = this.TssPlugin.parties[partyId];
    if(!party)
      throw `Party not created`
    console.log("========= creating Distributed key ... =========")
    let key = await this.TssPlugin.keyGen(party, {id: this.getAppTssKeyId(appId, seed)})
    console.log("key generated", key)
    return {
      address: key.address,
      encoded: key.publicKey?.encodeCompressed("hex"),
      x: key.publicKey?.getX().toBuffer('be', 32).toString('hex'),
      yParity: key.publicKey?.getY().isEven() ? 0 : 1
    }
  }
}

export default System
