import CallablePlugin from './base/callable-plugin.js'
import DistributedKey from "../../utils/tss/distributed-key.js";
import lodash from 'lodash'
import * as tssModule from '../../utils/tss/index.js'
import Web3 from 'web3'
import {timeout, stackTrace, uuid} from '../../utils/helpers.js'
import {remoteApp, remoteMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info.js";
import NodeCache from 'node-cache'
import * as SharedMemory from '../../common/shared-memory/index.js'
import * as NetworkIpc from '../../network/ipc.js'
import * as CoreIpc from '../ipc.js'
import {MuonNodeInfo} from "../../common/types";
import AppManager from "./app-manager.js";
import BN from 'bn.js';
import TssParty from "../../utils/tss/party.js";
import {IMpcNetwork} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base.js";
import {DistKey, DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import Log from '../../common/muon-log.js'
import {bigint2hex} from "../../utils/tss/utils.js";

const {shuffle} = lodash;
const {utils:{toBN}} = Web3;
const log = Log('muon:core:plugins:tss')

const LEADER_ID = process.env.LEADER_ID || '1';

export type PartyGenOptions = {
  /**
   * Party ID
   */
  id?: string,
  /**
   * Party Threshold
   */
  t: number,
  /**
   * Exact partners of party
   */
  partners?: string[]
}

export type KeyGenOptions = {
  /**
   key ID
   */
  id?: string,
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

const BroadcastMessage = {
  WhoIsThere: 'BROADCAST_MSG_WHO_IS_THERE',
};

const RemoteMethods = {
  recoverMyKey: 'recoverMyKey',
  createParty: 'createParty',
  keyGenStep1: 'kgs1',
  keyGenStep2: 'kgs2',
  storeTssKey: 'storeTssKey',
  iAmHere: "iAmHere",
  checkTssStatus: "checkTssStatus",
}

@remoteApp
class TssPlugin extends CallablePlugin {
  isReady = false
  parties:{[index: string]: TssParty} = {}
  tssKey: DistributedKey | null = null;
  tssParty: TssParty | null = null;
  appTss:{[index: string]: DistributedKey} = {}

  async onStart() {
    super.onStart();

    this.muon.on("collateral:node:add", this.onNodeAdd.bind(this));
    this.muon.on("collateral:node:edit", this.onNodeEdit.bind(this));
    this.muon.on("collateral:node:delete", this.onNodeDelete.bind(this));

    this.muon.on('global-tss-key:generate', this.onTssKeyGenerate.bind(this));
    this.muon.on('party:generate', this.loadParty.bind(this));

    // @ts-ignore
    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.collateralPlugin.waitToLoad()
    this.loadTssInfo();

  }

  async onNodeAdd(nodeInfo: MuonNodeInfo) {
    log(`node add %o`, nodeInfo)

    await timeout(5000);

    const selfInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
    if(!selfInfo) {
      log(`current node not in the network yet.`)
      return;
    }

    if(selfInfo.id === nodeInfo.id){
      log(`current node added to the network and loading tss info.`)
      this.loadTssInfo()
    }
    else {
      if(selfInfo.isDeployer) {
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
    await timeout(5000);

    if(nodeInfo.isDeployer !== oldNodeInfo.isDeployer) {
      const selfInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if(!selfInfo)
        return ;

      if(nodeInfo.isDeployer) {
        if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
          await this.loadTssInfo()
        }
        else {
          if(selfInfo.isDeployer)
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

  get TSS_THRESHOLD() {
    return this.muon.configs.net.tss.threshold;
  }

  get TSS_MAX() {
    return this.muon.configs.net.tss.max;
  }

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral')
  }

  private get appManager(): AppManager {
    return this.muon.getPlugin('app-manager');
  }

  getTssConfig(){
    let {tss: tssConfig} = this.muon.configs;
    if(!tssConfig)
      return null;

    if(!tssConfig.party.t) {
      return null;
    }

    return tssConfig;
  }

  async loadTssInfo() {
    if(!this.collateralPlugin.groupInfo || !this.collateralPlugin.networkInfo){
      throw {message: `TssPlugin.loadTssInfo: collateral plugin not loaded the network info.`}
    }
    let {groupInfo: {isValid, group, sharedKey, partners}, networkInfo} = this.collateralPlugin;

    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)

    /** current node not in the network */
    if(!currentNodeInfo || !currentNodeInfo.isDeployer) {
      return;
    }
    log(`loading global tss info ...`)

    //TODO: handle {isValid: false};

    let party = TssParty.load({
      id: 'deployers-party',
      t: networkInfo.tssThreshold,
      max: networkInfo.maxGroupSize,
      partners: this.collateralPlugin.filterNodes({
        isDeployer: true
      })
        .map(n => n.id)
    });
    this.parties[party.id] = party
    this.tssParty = party;
    log(`tss party loaded.`)

    // @ts-ignore
    this.emit('party-load');

    // this.tryToFindOthers(3);

    // validate tssConfig
    let tssConfig = this.getTssConfig();

    if(tssConfig && tssConfig.party.t == networkInfo.tssThreshold){
      let _key = {
        ...tssConfig.key,
        share: toBN(tssConfig.key.share),
        publicKey: tssModule.keyFromPublic(tssConfig.key.publicKey)
      }
      let key = DistributedKey.load(this.tssParty, _key);
      this.tssKey = key;
      this.isReady = true
      log('tss ready');
    }
    else{
      /** only one process allowed to create or recover Tss Key */
      let permitted = await NetworkIpc.askClusterPermission('tss-key-creation', 20000)
      if(!permitted)
        return;

      log('waiting for the threshold number of deployers to get online ...')
      while (true) {
        let onlineDeployers = this.collateralPlugin.filterNodes({
          list: this.tssParty!.partners,
          isDeployer: true,
          isOnline: true
        })
        if(onlineDeployers.length >= this.collateralPlugin.TssThreshold) {
          log(`${onlineDeployers.length} number of deployers are now online.`)
          break;
        }

        /** wait 5 seconds and retry again */
        log("online deployers %o", onlineDeployers.map(n => n.id))
        log(`waiting: only ${onlineDeployers.length} number of deployers are online.`)
        await timeout(5000);
      }

      const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if (currentNodeInfo && currentNodeInfo.id == LEADER_ID && await this.isNeedToCreateKey()) {
        log(`Got permission to create tss key`);
        let key: DistributedKey = await this.tryToCreateTssKey();
        log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        log(`trying to recover global tss key...`)
        await timeout(6000);

        // this.tryToFindOthers();

        while (!this.isReady) {
          await timeout(5000);
          let onlinePartners: MuonNodeInfo[] = this.collateralPlugin
            .filterNodes({
              isDeployer: true,
              isOnline: true,
              excludeSelf: true
            });

          let statuses = await Promise.all(onlinePartners.map(p => {
            return this.remoteCall(
              p.peerId,
              RemoteMethods.checkTssStatus
            ).catch(e => 'error')
          }))

          let filter = statuses.map(s => s.isReady)
          onlinePartners = onlinePartners.filter((p, i) => filter[i]);
          statuses = statuses.filter((s, i) => filter[i]);

          if(statuses.length >= this.collateralPlugin.TssThreshold){
            try {
              await this.tryToRecoverTssKey(onlinePartners);
            }
            catch (e) {
              log(`Error when trying to recover tss key`);
            }
          }
        }
      }
    }
  }

  appHasTssKey(appId: string): boolean {
    return !!this.appTss[appId]
  }

  getAppTssKey(appId: string): DistributedKey | null {
    if(appId == '1') {
      return this.tssKey;
    }
    if(!this.appTss[appId]) {
      const context = this.appManager.getAppContext(appId)
      if(!context)
        return null
      const _key = this.appManager.getAppTssKey(appId)
      if(!_key)
        return null
      let party = this.getAppParty(appId)
      const key = DistributedKey.load(party, {
        id: `app-${appId}`,
        share: _key.keyShare,
        publicKey: _key.publicKey.encoded,
        partners: context.party.partners
      })
      this.appTss[appId] = key;
    }
    return this.appTss[appId];
  }

  async onAppTssDelete(appId, appTssConfig) {
    log(`AppTss delete from db %s %o`, appId, appTssConfig)
    delete this.appTss[appId]
  }

  getAppPartyId(appId, version) {
    return `app-${appId}-${version}-party`;
  }

  getAppParty(appId: string) {
    const _context = this.appManager.getAppContext(appId)
    /** is app deployed? return if not. */
    if(!_context)
      return undefined;

    const partyId = this.getAppPartyId(appId, _context.version);

    if(!this.parties[partyId]) {
      this.loadParty({
        id: partyId,
        t: _context.party.t,
        max: _context.party.max,
        partners: _context.party.partners
      })
    }
    return this.parties[partyId];
  }

  async isNeedToCreateKey(){
    let onlineDeployers = this.collateralPlugin.filterNodes({
      list: this.tssParty!.partners,
      isOnline: true,
      isDeployer: true,
      excludeSelf: true
    })

    let statuses = await Promise.all(onlineDeployers.map(p => {
      return this.remoteCall(
        p!.peerId,
        RemoteMethods.checkTssStatus
      ).catch(e => 'error')
    }))

    // TODO: is this ok?
    let isReadyList: number[] = statuses.map(s => (s.isReady?1:0))
    let numReadyNodes: number = isReadyList.reduce((sum, r) => (sum+r), 0);


    return numReadyNodes < this.collateralPlugin.TssThreshold;
  }

  async tryToFindOthers(numTry=1) {
    for (let i = 0 ; i < numTry ; i++) {
      this.broadcast({
        method: BroadcastMessage.WhoIsThere,
        params: {
          peerId: process.env.PEER_ID,
        }
      })
      await timeout(5000)
    }
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
        // shared part of distributedKey
        share: `0x${key.share.toString(16)}`,
        // distributedKey public
        publicKey: `${key.publicKey.encode('hex')}`,
        // distributed key address
        address: tssModule.pub2addr(key.publicKey)
      }
    }

    this.muon.backupConfigFile('tss.conf.json');
    // console.log('save config temporarily disabled for test.');
    this.muon.saveConfig(tssConfig, 'tss.conf.json')
  }

  loadParty(party) {
    // console.log(`TssPlugin.loadParty`, party)
    if(party.partners.lengh > 0 && typeof party.partners[0] !== "string") {
      console.log("TssPlugin.loadParty.partners most be string array", party.partners)
      console.log(stackTrace())
    }
    try {
      let p = TssParty.load(party)
      this.parties[p.id] = p
    }
    catch (e) {
      console.log('loading party: ', party);
      console.log('partners info: ', party);
      console.log(`TssPlugin.loadParty ERROR:`, e)
    }
  }

  async onTssKeyGenerate(tssKey) {
    if(!this.isReady) {
      this.tssKey = DistributedKey.load(this.tssParty, tssKey);
      this.isReady = true;
    }
  }

  async tryToRecoverTssKey(partners: MuonNodeInfo[]){
    if(partners.length < this.collateralPlugin.TssThreshold)
      throw {message: "No enough online partners to recover key."};

    let nonce = await this.keyGen(this.tssParty, {id: `recovery-${uuid()}`});

    let keyResults = await Promise.all(
      partners.map(p => {
          return this.remoteCall(
            // online partners
            p.peerId,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id},
            {taskId: nonce.id}
          ).catch(e => {
            console.log(`TssPlugin.tryToRecoverTssKey ERROR:`, e)
            return null
          })
        }
      )
    )

    let shares = partners
      .map((p, j) => {
          if (!keyResults[j])
            return null
          return {
            i: p.id,
            key: tssModule.keyFromPrivate(keyResults[j].recoveryShare)
          }
        }
      )
      .filter(s => !!s)

    if (shares.length < this.tssParty!.t) {
      log(`Need's of ${this.tssParty!.t} result to recover the Key, but received ${shares.length} result.`)
      return false;
    }

    let myIndex = this.currentNodeInfo!.id;
    let reconstructed = tssModule.reconstructKey(shares, this.TSS_THRESHOLD, BigInt(myIndex))
    // console.log({recon: reconstructed.toString(16)})

    let myKey = tssModule.mod(reconstructed - nonce.share!)
    // console.log({myKey: '0x'+myKey.toString(16)})
    // this.parties[party.id] = party
    let tssKey = DistributedKey.load(this.tssParty, {
      id: keyResults[0].id,
      i: myIndex,
      share: myKey,
      publicKey: tssModule.keyFromPublic(keyResults[0].publicKey),
      address: keyResults[0].address,
    })

    this.tssKey = tssKey
    this.isReady = true;
    this.saveTssConfig(this.tssParty, tssKey)
    CoreIpc.fireEvent({type: "global-tss-key:generate", data: tssKey.toSerializable()});
    log(`${process.pid} tss key recovered`);
    return true;
  }

  async tryToCreateTssKey(): Promise<DistributedKey> {
    while (!this.isReady) {
      await timeout(5000);
      try {
        let key: DistributedKey = await this.keyGen(this.tssParty, {lowerThanHalfN: true})

        let keyPartners = this.collateralPlugin.filterNodes({list: key.partners})
        let callResult = await Promise.all(keyPartners.map(({wallet, peerId}) => {
          if (wallet === process.env.SIGN_WALLET_ADDRESS)
            return Promise.resolve(true);
          ;

          return this.remoteCall(
            peerId,
            RemoteMethods.storeTssKey,
            {
              party: this.tssParty!.id,
              key: key.id,
            },
            // {taskId: `keygen-${key.id}`}
          ).catch(()=>false);
        }))
        // console.log(`key save broadcast count: ${key.partners.length}`, callResult);
        if (callResult.filter(r => r === true).length < this.TSS_THRESHOLD)
          throw `Tss creation failed.`
        this.saveTssConfig(this.tssParty, key)

        this.tssKey = key;
        this.isReady = true;
        CoreIpc.fireEvent({type: "global-tss-key:generate", data: key.toSerializable()});
        log('tss ready.')
      } catch (e) {
        log('error when trying to create tss key %o %o', e, e.stack);
      }
    }

    return this.tssKey!
  }

  async createParty(options: PartyGenOptions) {
    let {
      id,
      t,
      partners=[]
    } = options

    if(partners.length === 0)
      throw `Generating new Party without partners, is not implemented yet.`

    const newParty = {
      id: id || TssParty.newId(),
      t,
      max: partners.length,
      partners
    }
    if(!id || !this.parties[id])
      CoreIpc.fireEvent({type: "party:generate", data: newParty});
    /**
     * filter partners and keep online ones.
     */
    // @ts-ignore
    const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: partners,
      isOnline: true
    })

    let callResult = await Promise.all(
      partnersToCall
        .map(({peerId, wallet}) => {
          if(wallet === process.env.SIGN_WALLET_ADDRESS)
            return true;
          return this.remoteCall(
            peerId,
            RemoteMethods.createParty,
            newParty, // TODO: send less data. just send id and partners wallet
            {timeout: 15000}
          ).catch(e => {
            console.log("TssPlugin.createParty", e)
            return 'error'
          })
        })
    )
    const failed = partners.filter((p, i) => callResult[i]==='error')
    if(failed.length > 0)
      throw `${failed.length} partner failed when creating party.`
    return newParty.id;
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<DistributedKey>}
   */
  async keyGen(party, options: KeyGenOptions={}): Promise<DistributedKey> {
    let network: IMpcNetwork = this.muon.getPlugin('mpcnet');
    let {id, maxPartners, timeout=30000, value} = options;
    let partners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: party.partners, isOnline: true})
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

    let keyGen: DistributedKeyGeneration, dKey: DistKey;
    do {
      keyGen = new DistributedKeyGeneration(
        uuid(),
        partners.map(p => p.id),
        party.t,
        options.value,
        {party: party.id, keyId: id || uuid(), lowerThanHalfN: options.lowerThanHalfN}
      );
      dKey = await keyGen.runByNetwork(network, timeout)
    }
    while(options.lowerThanHalfN && dKey.publicKeyLargerThanHalfN());

    // @ts-ignore
    let key = DistributedKey.load(party, {
      id: keyGen.extraParams.keyId!,
      share: bigint2hex(dKey.share),
      publicKey: dKey.publicKey,
      partners: keyGen.partners
    })

    await SharedMemory.set(keyGen.extraParams.keyId, key.toSerializable(), 30*60*1000)
    return key;
  }

  async getSharedKey(id: string): Promise<DistributedKey> {
    let key = await SharedMemory.waitAndGet(id, 5000)
    let party = this.getParty(key.party);
    if(!party)
      throw `party [${key.party}] not found`
    return DistributedKey.load(party, key)
  }

  getParty(id) {
    return this.parties[id];
  }

  async handleBroadcastMessage(msg, callerInfo) {
    let {method, params} = msg;
    // console.log("TssPlugin.handleBroadcastMessage",msg, {callerInfo})
    switch (method) {
      case BroadcastMessage.WhoIsThere: {
        // console.log(`=========== InformEntrance ${wallet}@${peerId} ===========`)
        // TODO: is this message from 'wallet'
        if (!!this.tssParty) {
          this.remoteCall(
            callerInfo.peerId,
            RemoteMethods.iAmHere
          ).catch(e => {})
        }
        break;
      }
      default:
        log(`unknown message %o`, msg);
    }
  }

  @broadcastHandler
  async onBroadcastReceived(data={}, callerInfo) {
    try {
      // let data = JSON.parse(uint8ArrayToString(msg.data));
      await this.handleBroadcastMessage(data, callerInfo)
    } catch (e) {
      console.error('TssPlugin.__onBroadcastReceived', e)
    }
  }

  /**==================================
   *
   *           Remote Methods
   *
   *===================================*/

  /**
   * Each node can request other nodes to recover its own key.
   * This process will be done after creating a DistributedKey as a nonce.
   *
   * @param data: Key recovery info
   * @param data.nonce: Nonce id that crated for key recovery
   *
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<{address: string, recoveryShare: string, id: *, publicKey: string}|null>}
   * @private
   */
  @remoteMethod(RemoteMethods.recoverMyKey)
  async __recoverMyKey(data: {nonce: string}, callerInfo) {
    // TODO: can malicious user use a nonce twice?
    // console.log('TssPlugin.__recoverMyKey', data, callerInfo.wallet)
    if(!callerInfo.isDeployer)
      throw `Only deployer nodes can have global tss`

    if(!this.tssKey || !this.tssParty){
        throw "Tss not initialized"
    }

    let {tssParty, tssKey} = this

    if (!tssParty!.partners.includes(callerInfo.id))
      throw `Not included in the global party`;

    let {nonce: nonceId} = data
    if (!!tssKey && nonceId === tssKey!.id)
      throw `Cannot use tss key as nonce`;

    let nonce = await this.getSharedKey(nonceId)
    let keyPart = tssModule.mod(nonce.share! + tssKey.share!);
    return {
      id: tssKey!.id,
      recoveryShare: `0x${keyPart.toString(16)}`,
      // distributedKey public
      publicKey: `${tssKey!.publicKey!.toHex(true)}`,
      // distributed key address
      address: tssModule.pub2addr(tssKey!.publicKey!)
    }
  }

  @remoteMethod(RemoteMethods.createParty)
  async __createParty(data: PartyGenOptions, callerInfo) {
    // console.log('TssPlugin.__createParty', data)
    if(!data.id || !this.parties[data.id]) {
      CoreIpc.fireEvent({
        type: "party:generate",
        data
      });
    }
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
  @remoteMethod(RemoteMethods.storeTssKey)
  async __storeTssKey(data: {party: string, key: string}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    // console.log('TssPlugin.__storeTssKey', data)
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key = await this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.__storeTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.__storeTssKey: key not found.'};
    if(callerInfo.id==LEADER_ID && await this.isNeedToCreateKey()) {
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      CoreIpc.fireEvent({type: "global-tss-key:generate", data: key.toSerializable()});
      log('save done')
      // CoreIpc.fireEvent({type: "tss:generate", })
      return true;
    }
    else{
      throw "Not permitted to create tss key"
    }
  }

  @remoteMethod(RemoteMethods.iAmHere)
  async __iAmHere(data={}, callerInfo) {
    // console.log('TssPlugin.__iAmHere', data)
  }

  @remoteMethod(RemoteMethods.checkTssStatus)
  async __checkTssStatus(data={}, callerInfo) {
    return {
      isReady: this.isReady,
      address: this.tssKey?.address,
    }
  }
}

export default TssPlugin;
