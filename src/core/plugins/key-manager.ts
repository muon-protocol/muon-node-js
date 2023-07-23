import CallablePlugin from './base/callable-plugin.js'
import AppTssKey, {AppTssKeyJson} from "../../utils/tss/app-tss-key.js";
import lodash from 'lodash'
import * as tssModule from '../../utils/tss/index.js'
import {timeout, stackTrace, uuid, pub2json} from '../../utils/helpers.js'
import {remoteApp, remoteMethod} from './base/app-decorators.js'
import NodeManagerPlugin from "./node-manager.js";
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import * as CoreIpc from '../ipc.js'
import {AppContext, MuonNodeInfo, NetConfigs, PartyInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import TssParty from "../../utils/tss/party.js";
import {IMpcNetwork, MapOf} from "../../common/mpc/types";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from "../../common/mpc/dist-key.js";
import {logger} from '@libp2p/logger'
import {bn2hex} from "../../utils/tss/utils.js";
import {useOneTime} from "../../utils/tss/use-one-time.js";
import {KeyRedistribution} from "../../common/mpc/kdist.js";
import MpcNetworkPlugin from "./mpc-network";

const {shuffle} = lodash;
const log = logger('muon:core:plugins:tss')

const LEADER_ID = process.env.LEADER_ID || '1';

export type KeyGenOptions = {
  /**
   key ID
   */
  id?: string,
  /**
   partners to generate key between them
   */
  partners?: string[],
  /**
   * The partners subset who responsible to initialize and create the key.
   */
  dealers?: string[],
  /**
   Max number of partners to generate key.
   This option will ignore if exact list of partners specified
   */
  maxPartners?: number,
  /**
   Timeout for key generation process
   */
  timeout?: number,
  /**
   * If you set this value, the value will be shared between partners.
   */
  value?: string,

  lowerThanHalfN?: boolean,
}

const RemoteMethods = {
  storeDeploymentTssKey: 'storeDeploymentTssKey',
}

@remoteApp
class KeyManager extends CallablePlugin {
  isReady = false
  parties:{[index: string]: TssParty} = {}
  tssKey: AppTssKey | null = null;
  tssParty: TssParty | null = null;
  /**
   map appId and seed to App TSS key
   example: appTss[appId][seed] = AppTssKey
   */
  appTss:{[index: string]: {[index: string]: AppTssKey}} = {}

  async onStart() {
    super.onStart();

    this.muon.on("contract:node:add", this.onNodeAdd.bind(this));
    this.muon.on("contract:node:edit", this.onNodeEdit.bind(this));
    this.muon.on("contract:node:delete", this.onNodeDelete.bind(this));

    this.muon.on('app-context:delete', this.onAppContextDelete.bind(this))
    this.muon.on('deployment-tss-key:generate', this.onDeploymentTssKeyGenerate.bind(this));

    // @ts-ignore
    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.nodeManager.waitToLoad()
    await this.appManager.waitToLoad();
    this.loadDeploymentTss();

    const mpcNetwork:MpcNetworkPlugin = this.muon.getPlugin('mpcnet');
    mpcNetwork.registerMpcInitHandler("DistributedKeyGeneration", this.dkgInitializeHandler.bind(this))
    mpcNetwork.registerMpcInitHandler("KeyRedistribution", this.keyRedistInitHandler.bind(this))
  }

  async onNodeAdd(nodeInfo: MuonNodeInfo) {
    log(`node add %o`, nodeInfo)

    //await timeout(5000);

    const selfInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
    if(!selfInfo) {
      log(`current node not in the network yet.`)
      return;
    }

    if(selfInfo.id === nodeInfo.id){
      log(`current node added to the network and loading tss info.`)
      this.loadDeploymentTss()
    }
    else {
      if(nodeInfo.isDeployer) {
        log(`adding the new node [%s] into the tss party.`, nodeInfo.id);
        this.tssParty!.addPartner(nodeInfo.id)
      }
    }
  }

  async onNodeEdit(data: {nodeInfo: MuonNodeInfo, oldNodeInfo: MuonNodeInfo}) {
    const {nodeInfo, oldNodeInfo} = data
    log(`node edit %o`, {nodeInfo, oldNodeInfo})

    /**
     * if the current node is edited, its needs some time to tssParty be updated
     */
    log("onNodeEdit timeout(5000)")
    await timeout(5000);

    if(nodeInfo.isDeployer !== oldNodeInfo.isDeployer) {
      const selfInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if(!selfInfo)
        return ;

      if(nodeInfo.isDeployer) {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          await this.loadDeploymentTss()
        }
        else {
          if(nodeInfo.isDeployer)
            this.tssParty!.addPartner(nodeInfo.id)
        }
      }
      else {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          this.isReady = false
          this.tssKey = null
          if(this.tssParty) {
            const p = this.tssParty
            delete this.parties[p.id];
          }
        }
        else {
          if(this.tssParty)
            this.tssParty.deletePartner(nodeInfo.id);
        }
      }
    }
  }

  onNodeDelete(nodeInfo: MuonNodeInfo) {
    log(`Node delete %o`, nodeInfo)
    Object.keys(this.parties).forEach(partyId => {
      const party = this.parties[partyId]
      party.deletePartner(nodeInfo.id);
    })
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager')
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  getDeploymentTssConfig(){
    let {tss: tssConfig} = this.muon.configs;
    if(!tssConfig)
      return null;

    if(!tssConfig.party.t) {
      return null;
    }

    return tssConfig;
  }

  async loadDeploymentTss() {

    const currentNodeInfo = this.nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)

    /** current node not in the network */
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      return;
    }
    log(`loading deployment tss info ...`)

    //TODO: handle {isValid: false};

    this.tssParty = this.getAppParty("1", "1")!;
    log(`tss party loaded.`)

    // @ts-ignore
    this.emit('party-load');

    // this.tryToFindOthers(3);

    // validate tssConfig
    let tssConfig = this.getDeploymentTssConfig();

    if(tssConfig && tssConfig.party.t == this.netConfigs.tss.threshold){
      let key = AppTssKey.fromJson(
        this.tssParty,
        this.nodeManager.currentNodeInfo!.id,
        {
          id: tssConfig.key.id,
          share: tssConfig.key.share,
          publicKey: tssConfig.key.publicKey,
          partners: this.tssParty.partners,
          polynomial: tssConfig.key.polynomial,
        }
      );
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
      this.tssKey = key;
      this.isReady = true
      log('deployment tss is ready.');
    }
  }

  getAppTssKey(appId: string, seed: string): AppTssKey | null {
    if(appId == '1') {
      return this.tssKey;
    }
    if(!this.appTss[appId]) {
      this.appTss[appId] = {}
    }
    if(!this.appTss[appId][seed]) {
      const context = this.appManager.getAppContext(appId, seed)
      if (!context)
        return null

      const _key = this.appManager.getAppTssKey(appId, seed)
      if (!_key)
        return null

      let party = this.getAppParty(appId, seed)
      if(!party)
        return null;

      const key = AppTssKey.fromJson(
        party,
        this.appManager.currentNodeInfo!.id,
        {
          id: `app-${appId}`,
          share: _key.keyShare!,
          publicKey: _key.publicKey!.encoded!,
          partners: context.party.partners,
          polynomial: _key.polynomial,
        }
      )
      this.appTss[appId][seed] = key;
    }
    return this.appTss[appId][seed];
  }

  private async onAppContextDelete(data: {contexts: any[]}) {
    let {contexts} = data
    for(const context of contexts) {
      const {appId, seed} = context
      const partyId = this.getAppPartyId(context);
      delete this.parties[partyId]
      if(!!this.appTss[appId])
        delete this.appTss[appId][seed]
    }
  }

  async onAppTssDelete(appId, appTssConfig) {
    log(`AppTss delete from db %s %o`, appId, appTssConfig)
    const {seed} = appTssConfig
    if(!!this.appTss[appId])
      delete this.appTss[appId][seed]
  }

  getAppPartyId(context, isForReshare:boolean=false) {
    const {seed, previousSeed} = context
    return isForReshare ? `app-${seed}-${previousSeed}-party` : `app-${seed}-party`;
  }

  getAppParty(appId: string, seed: string, isForReshare:boolean=false): TssParty|undefined {
    const _context:AppContext = this.appManager.getAppContext(appId, seed)
    /** is app deployed? return if not. */
    if(!_context)
      return undefined;

    const partyId = this.getAppPartyId(_context, isForReshare);

    if(!this.parties[partyId]) {
      let partners = _context.party.partners
      if(isForReshare){
        const previousContext: AppContext = this.appManager.getAppContext(appId, _context.previousSeed)
        if(!previousContext)
          return undefined;
        partners = lodash.uniq([
          ..._context.party.partners,
          ...previousContext.party.partners
        ])
      }
      this.loadParty({
        id: partyId,
        t: _context.party.t,
        max: _context.party.max,
        partners
      })
    }
    return this.parties[partyId];
  }

  async getAppPartyAsync(appId: string, seed: string, isForReshare:boolean=false) {
    const _context:AppContext|undefined = await this.appManager.getAppContextAsync(appId, seed, true)
    /** is app deployed? return if not. */
    if(!_context)
      return undefined;

    const partyId = this.getAppPartyId(_context, isForReshare);

    if(!this.parties[partyId]) {
      let partners = _context.party.partners
      if(isForReshare){
        const previousContext: AppContext|undefined = await this.appManager.getAppContextAsync(appId, _context.previousSeed, true)
        if(!previousContext)
          return undefined;
        partners = lodash.uniq([
          ..._context.party.partners,
          ...previousContext.party.partners
        ])
      }
      this.loadParty({
        id: partyId,
        t: _context.party.t,
        max: _context.party.max,
        partners
      })
    }
    return this.parties[partyId];
  }

  async isNeedToCreateKey(){
    log("checking for deployment key creation ...")
    const deployers: string[] = this.nodeManager.filterNodes({isDeployer: true}).map(p => p.peerId)
    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers,
      Math.ceil(this.tssParty!.t*1.2),
      {timeout: 10000, return: 'peerId'}
    )
    if(onlineDeployers.length < this.tssParty!.t) {
      log("no enough online deployers to check the key creation ...")
      return false;
    }

    const readyDeployers = await this.appManager.findNAvailablePartners(
      deployers,
      this.netConfigs.tss.threshold,
      {appId: "1", seed: "1"}
    )
    log(`there is ${readyDeployers.length} deployers are ready.`)
    return readyDeployers.length < this.netConfigs.tss.threshold;
  }

  saveTssConfig(party, key) {
    let tssConfig = {
      party: {
        id: party.id,
        t: party.t,
        max: party.max
      },
      key: {
        id: key.id,
        // shared part of tss key
        share: `0x${key.share.toString(16)}`,
        // public of tss key
        publicKey: `${key.publicKey.encode('hex', true)}`,
        // distributed key address
        address: tssModule.pub2addr(key.publicKey),
        // tss key's polynomial info
        ...(!!key.polynomial ? {polynomial: key.toJson().polynomial} : {}),
      }
    }

    this.muon.backupConfigFile('tss.conf.json');
    // console.log('save config temporarily disabled for test.');
    this.muon.saveConfig(tssConfig, 'tss.conf.json')
  }

  loadParty(party) {
    // console.log(`KeyManager.loadParty`, party)
    if(party.partners.lengh > 0 && typeof party.partners[0] !== "string") {
      console.log("KeyManager.loadParty.partners most be string array", party.partners)
      console.log(stackTrace())
    }
    try {
      let p = TssParty.load(party)
      this.parties[p.id] = p
    }
    catch (e) {
      console.log('loading party: ', party);
      console.log('partners info: ', party);
      console.log(`KeyManager.loadParty ERROR:`, e)
    }
  }

  async onDeploymentTssKeyGenerate(tssKey) {
    if(!this.isReady) {
      this.tssKey = AppTssKey.fromJson(this.tssParty!, this.nodeManager.currentNodeInfo!.id, tssKey);
      this.isReady = true;
    }
  }

  async createDeploymentTssKey(): Promise<AppTssKey> {
    const currentNode = this.nodeManager.currentNodeInfo!;
    const deployers: MuonNodeInfo[] = this.nodeManager.filterNodes({isDeployer: true})
    const onlineDeployers: string[] = await NetworkIpc.findNOnlinePeer(
      deployers.map(n => n.peerId),
      Math.ceil(this.tssParty!.t*1.2),
      {timeout: 10000}
    )
    if(onlineDeployers.length < this.tssParty!.t) {
      log(`Its need ${this.tssParty!.t} deployer to create deployment tss but only ${onlineDeployers.length} are available`)
      throw `No enough online deployers to create the deployment tss key.`
    }
    log(`Deployers %o are available to create deployment tss`, onlineDeployers)

    let key: AppTssKey = await this.keyGen(
      {appId: "1", seed: "1"},
      {
        partners: deployers.map(n => n.id),
        dealers: onlineDeployers,
        lowerThanHalfN: true
      }
    )

    let keyPartners = deployers.filter(n => (n.id !== currentNode.id));
    let callResult = await Promise.all(keyPartners.map(({wallet, peerId}) => {
      return this.remoteCall(
        peerId,
        RemoteMethods.storeDeploymentTssKey,
        {
          party: this.tssParty!.id,
          key: key.id,
        },
        {timeout: 120e3}
        // {taskId: `keygen-${key.id}`}
      ).catch(e=>{
        console.log("RemoteCall.storeDeploymentTssKey", e);
        return false
      });
    }))
    if (callResult.filter(r => r === true).length+1 < this.netConfigs.tss.threshold)
      throw `Tss creation failed.`
    await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
    this.saveTssConfig(this.tssParty, key)

    this.tssKey = key;
    this.isReady = true;
    CoreIpc.fireEvent({type: "deployment-tss-key:generate", data: key.toJson()});

    return this.tssKey!
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<AppTssKey>}
   */
  async keyGen(partyInfo: PartyInfo, options: KeyGenOptions={}): Promise<AppTssKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, partners: oPartners, maxPartners, timeout=60000, value} = options;

    const party = this.getAppParty(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare)

    if(!party)
      throw {message: `party not found`, partyInfo}

    let candidatePartners = party.partners;
    if(oPartners)
      candidatePartners = candidatePartners.filter(p => oPartners!.includes(p));

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: candidatePartners,
    })

    if(maxPartners && maxPartners > 0) {
      /** exclude current node and add it later */
      partners = partners.filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS))
      partners = [
        /** self */
        this.currentNodeInfo!,
        /** randomly select (maxPartners - 1) from others */
        ...shuffle(partners).slice(0, maxPartners - 1)
      ];
      // console.log(partners)
      // partners = partners.slice(0, maxPartners);
    }

    const keyId = id || uuid()

    log(`creating key with partners: %o`, partners.map(p => p.id))

    let keyGen: DistributedKeyGeneration, dKey: DistKey;
    do {
      keyGen = new DistributedKeyGeneration({
        /** MPC ID */
        id: uuid(),
        /**
         * starter of MPC
         * starter have higher priority than others when selecting MPC fully connected sub set.
         */
        starter: this.nodeManager.currentNodeInfo!.id,
        /** partners list */
        partners: partners.map(p => p.id),
        dealers: options.dealers || undefined,
        /** DKG threshold */
        t: party.t,
        /** DKG value to be shared between partners */
        value: options.value,
        /** extra values usable in DKG */
        extra: {
          mpcType: "DistributedKeyGeneration",
          partyInfo,
            keyId,
            lowerThanHalfN
        :
          options.lowerThanHalfN,
        }
      });
      dKey = await keyGen.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    let key = new AppTssKey(party, keyGen.extraParams.keyId!, dKey)

    await SharedMemory.set(keyGen.extraParams.keyId, {partyInfo, key: key.toJson()}, 30*60*1000)
    return key;
  }

  async dkgInitializeHandler(constructData, network: MpcNetworkPlugin) {
    const dkg = new DistributedKeyGeneration(constructData)
    const {extra} = constructData

    dkg.runByNetwork(network)
      .then(async (dKey: DistKey) => {
        if(extra.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
          return;

        const partyInfo: PartyInfo = extra.partyInfo as PartyInfo
        const party = await this.getAppPartyAsync(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare);
        if(!party)
          throw `party[${extra.party}] not found`

        let key = new AppTssKey(party, extra.keyId, dKey)
        await SharedMemory.set(extra.keyId, {partyInfo, key: key.toJson()}, 30*60*1000)
      })
      .catch(e => {
        // TODO
        log.error("KeyManager running mpc failed. %O", e)
      })

    return dkg;
  }

  async keyRedistInitHandler(constructData, network:MpcNetworkPlugin): Promise<KeyRedistribution> {
    const {extra} = constructData
    const {prevPartyInfo: {appId, seed}} = extra;
    const currentNode = this.nodeManager.currentNodeInfo!;
    const key = this.appManager.getAppTssKey(appId, seed);
    const keyRedist = new KeyRedistribution({
      ...constructData,
      dealers: !!key ? constructData.dealers : constructData.dealers.filter(id => id !== currentNode.id),
      value: !!key ? key.keyShare : undefined
    });

    keyRedist.runByNetwork(network)
      .then(async (dKey: DistKey) => {
        if(extra.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
          return;

        const partyInfo: PartyInfo = extra.partyInfo as PartyInfo
        const party = await this.getAppPartyAsync(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare);
        if(!party)
          throw `party[${extra.party}] not found`

        let key = new AppTssKey(party, extra.keyId, dKey)
        await SharedMemory.set(extra.keyId, {partyInfo, key: key.toJson()}, 30*60*1000)
      })
      .catch(e => {
        // TODO
        log.error("KeyManager running mpc failed. %O", e)
      })

    return keyRedist;
  }

  async redistributeKey(prevPartyInfo: PartyInfo, newPartyInfo: PartyInfo, options: KeyGenOptions={}): Promise<AppTssKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, timeout=60000} = options;

    const prevParty = this.getAppParty(prevPartyInfo.appId, prevPartyInfo.seed)
    if(!prevParty)
      throw {message: `party not found`, prevPartyInfo}

    const newParty = this.getAppParty(newPartyInfo.appId, newPartyInfo.seed)
    if(!newParty)
      throw {message: `party not found`, newPartyInfo};

    if(!this.appManager.appHasTssKey(prevPartyInfo.appId, prevPartyInfo.seed))
      throw {message: `the previous party doesn't have the tss key.`}

    let partners: MuonNodeInfo[] = this.nodeManager.filterNodes({
      list: newParty.partners,
    })

    const keyId = id || uuid()

    log(`creating key with partners: %o`, partners.map(p => p.id))

    const appKey = this.appManager.getAppTssKey(prevPartyInfo.appId, prevPartyInfo.seed);

    let keyRedist: KeyRedistribution, dKey: DistKey;
    do {
      keyRedist = new KeyRedistribution({
        /** MPC ID */
        id: uuid(),
        /**
         * starter of MPC
         * starter have higher priority than others when selecting MPC fully connected sub set.
         */
        starter: this.nodeManager.currentNodeInfo!.id,
        /** partners of the old party, that redistribute the key to the new partners. */
        dealers: lodash.intersection(prevParty.partners, newParty.partners),
        /** partners list */
        partners: partners.map(p => p.id),
        /** Previous party threshold */
        previousT: prevParty.t,
        /** DKG threshold */
        t: newParty.t,
        /** DKG value to be shared between partners */
        value: appKey.keyShare,
        /** public key of distributed key */
        publicKey: appKey.publicKey.encoded!,
        /** extra values usable in DKG */
        extra: {
          mpcType: "KeyRedistribution",
          prevPartyInfo: prevPartyInfo,
          partyInfo: newPartyInfo,
          keyId,
          lowerThanHalfN: options.lowerThanHalfN,
        }
      });
      dKey = await keyRedist.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    let key = new AppTssKey(newParty, keyRedist.extraParams.keyId!, dKey)

    await SharedMemory.set(keyRedist.extraParams.keyId, {partyInfo: newPartyInfo, key: key.toJson()}, 30*60*1000)
    return key;
  }

  async getSharedKey(id: string, timeout:number=5000): Promise<AppTssKey> {
    let {partyInfo, key} = await SharedMemory.waitAndGet(id, timeout)
    let party = this.getAppParty(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare);
    if(!party)
      throw `party [${key.party}] not found`

    return AppTssKey.fromJson(party, this.currentNodeInfo!.id, key)
  }

  getParty(id) {
    return this.parties[id];
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

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
  @remoteMethod(RemoteMethods.storeDeploymentTssKey)
  async __storeDeploymentTssKey(data: {party: string, key: string}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key: AppTssKey = await this.getSharedKey(keyId);
    if (!party)
      throw {message: 'KeyManager.storeDeploymentTssKey: party not found.'}
    if (!key)
      throw {message: 'KeyManager.storeDeploymentTssKey: key not found.'};
    if(callerInfo.id==LEADER_ID && await this.isNeedToCreateKey()) {
      await useOneTime("key", key.publicKey!.encode('hex', true), `app-1-tss`)
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      CoreIpc.fireEvent({type: "deployment-tss-key:generate", data: key.toJson()});
      log('save done')
      // CoreIpc.fireEvent({type: "tss:generate", })
      return true;
    }
    else{
      throw "Not permitted to create tss key"
    }
  }
}

export default KeyManager;
