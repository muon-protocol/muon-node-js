import CallablePlugin from './base/callable-plugin'
import Party from '../../utils/tss/party'
import DistributedKey from "../../utils/tss/distributed-key";
const {shuffle} = require('lodash')
const tssModule = require('../../utils/tss/index')
const {utils:{toBN}} = require('web3')
const {timeout, stackTrace} = require('../../utils/helpers');
import {remoteApp, remoteMethod, broadcastHandler} from './base/app-decorators'
import CollateralInfoPlugin from "./collateral-info";
const NodeCache = require('node-cache');
const NetworkIpc = require('../../network/ipc')
import * as CoreIpc from '../ipc'
import {MuonNodeInfo} from "../../common/types";
import AppManager from "./app-manager";
import BN from 'bn.js';
const log = require('debug')('muon:core:plugins:tss')

const LEADER_ID = process.env.LEADER_ID || '1';

const keysCache = new NodeCache({
  stdTTL: 6*60, // Keep distributed keys in memory for 6 minutes
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 60,
  useClones: false,
});

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
  value?: BN
}

const BroadcastMessage = {
  WhoIsThere: 'BROADCAST_MSG_WHO_IS_THERE',
};

const RemoteMethods = {
  recoverMyKey: 'recoverMyKey',
  createParty: 'createParty',
  createKey: 'createKey',
  distributeKey: 'distributeKey',
  storeTssKey: 'storeTssKey',
  iAmHere: "iAmHere",
  checkTssStatus: "checkTssStatus",
}

@remoteApp
class TssPlugin extends CallablePlugin {
  isReady = false
  parties:{[index: string]: Party} = {}
  tssKey: DistributedKey | null = null;
  tssParty: Party | null = null;
  availablePeers = {}
  appTss:{[index: string]: DistributedKey} = {}

  async onStart() {
    super.onStart();

    this.muon.on('peer:discovery', this.onPeerDiscovery.bind(this));
    this.muon.on('peer:connect', this.onPeerConnect.bind(this));
    this.muon.on('peer:disconnect', this.onPeerDisconnect.bind(this));

    this.muon.on("node:add", this.onNodeAdd.bind(this));
    this.muon.on("node:edit", this.onNodeEdit.bind(this));
    this.muon.on("node:delete", this.onNodeDelete.bind(this));

    this.muon.on('tss-key:generate', this.onTssKeyGenerate.bind(this));
    this.muon.on('key:generate', this.onDKeyGenerate.bind(this));
    this.muon.on('party:generate', this.loadParty.bind(this));

    this.appManager.on('app-tss:delete', this.onAppTssDelete.bind(this))

    await this.collateralPlugin.waitToLoad()
    this.loadTssInfo();

  }

  onNodeAdd(nodeInfo: MuonNodeInfo) {
    log(`Node add %o`, nodeInfo)
    Object.keys(this.parties).forEach(partyId => {
      this.parties[partyId].addPartner(nodeInfo);
      if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS) {
        this.loadTssInfo()
      }
      else {
        this.findPeerInfo(nodeInfo.peerId);
      }
    })
  }

  onNodeEdit(nodeInfo: MuonNodeInfo) {
    console.log(`Node edit %o`, nodeInfo)
    Object.keys(this.parties).forEach(partyId => {
      this.parties[partyId].addPartner(nodeInfo);
      if(nodeInfo.wallet !== process.env.SIGN_WALLET_ADDRESS)
        this.findPeerInfo(nodeInfo.peerId);
    })
  }

  onNodeDelete(nodeInfo: MuonNodeInfo) {
    log(`Node delete %o`, nodeInfo)
    Object.keys(this.parties).forEach(partyId => {
      const party = this.parties[partyId]
      party.deletePartner(nodeInfo.id);
    })
  }

  async onPeerDiscovery(peerId: string) {
    log(`Peer discovered %s`, peerId);
    this.availablePeers[peerId] = true
    this.findPeerInfo(peerId);
  }

  async onPeerConnect(peerId: string) {
    log(`Peer connected %s`, peerId)
    this.availablePeers[peerId] = true
    this.findPeerInfo(peerId)
  }

  onPeerDisconnect(disconnectedPeer: string) {
    log(`Peer disconnect %s`, disconnectedPeer)
    delete this.availablePeers[disconnectedPeer];
    const nodeInfo = this.collateralPlugin.getNodeInfo(disconnectedPeer)
    if(!nodeInfo)
      return;
    log(`remove online peer ${nodeInfo.wallet}@${disconnectedPeer}`)
    Object.keys(this.parties).forEach(partyId => {
      const party = this.parties[partyId]
      party.setNodePeer(nodeInfo.id, null);
    })
  }

  async findPeerInfo(peerId){
    if(!this.collateralPlugin.isLoaded()) {
      return ;
    }
    try {
      let nodeInfo = this.collateralPlugin.getNodeInfo(peerId);
      if(nodeInfo) {
        if (!!this.tssParty) {
          if (nodeInfo.wallet) {
            // console.log(`[${process.pid}] TssPlugin: adding online peer`, {peerId, peerWallet})
            Object.keys(this.parties).forEach(partyId => {
              this.parties[partyId].setNodePeer(nodeInfo!.id, peerId);
            })
          }
        } else {
          console.log(`There is no tss party`);
        }
      }else {
        console.log("Peer connected with unknown peerId", peerId);
      }
    }catch (e) {
      console.log("TssPlugin.findPeerInfo", e);
    }
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
    if(!currentNodeInfo) {
      return;
    }

    //TODO: handle {isValid: false};

    let party = Party.load({
      id: group,
      t: networkInfo.tssThreshold,
      max: networkInfo.maxGroupSize,
      partners: partners.map(id => this.collateralPlugin.getNodeInfo(id)!)
    });
    this.parties[party.id] = party
    this.tssParty = party;

    Object.keys(this.availablePeers).forEach(peerId => {
      this.findPeerInfo(peerId);
    })

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
      keysCache.set(key.id, key, 0);
      this.tssKey = key;
      this.isReady = true
      log('tss ready');
    }
    else{
      let permitted = await NetworkIpc.askClusterPermission('tss-key-creation', 20000)
      if(!permitted)
        return;

      const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
      if (currentNodeInfo && currentNodeInfo.id == LEADER_ID && await this.isNeedToCreateKey()) {
        log(`Got permission to create tss key`);
        let key = await this.tryToCreateTssKey();
        log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        await timeout(6000);

        // this.tryToFindOthers();

        while (!this.isReady) {
          await timeout(5000);
          let onlinePartners: MuonNodeInfo[] = Object.values(this.tssParty.onlinePartners)
            .filter((op: MuonNodeInfo) => {
              return op.wallet !== process.env.SIGN_WALLET_ADDRESS
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
    let myWallet = process.env.SIGN_WALLET_ADDRESS;
    let onlinePartners = Object.values(this.tssParty!.onlinePartners).filter(p => (p.wallet !== myWallet))
    let statuses = await Promise.all(onlinePartners.map(p => {
      return this.remoteCall(
        p.peer,
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
      stackTrace()
    }
    try {
      let p = Party.load({
        ...party,
        partners: party.partners.map(id => this.collateralPlugin.getNodeInfo(id))
      })
      Object.keys(this.availablePeers).forEach(peerId => {
        const id = this.collateralPlugin.getNodeInfo(peerId)!.id;
        // TODO: no need the line below bot check it more
        p.setNodePeer(id, peerId)
      })
      this.parties[p.id] = p
    }
    catch (e) {
      console.log('loading party: ', party);
      console.log(`TssPlugin.loadParty ERROR:`, e)
    }
  }

  async onTssKeyGenerate(tssKey) {
    if(!this.isReady) {
      this.tssKey = DistributedKey.load(this.tssParty, tssKey);
      this.isReady = true;
    }
  }

  onDKeyGenerate(_key, {pid}) {
    // console.log(`TssPlugin.onDKeyGenerate`, {pid: process.pid, senderPid: pid}, _key);
    const party = this.parties[_key.party]
    if(!party) {
      console.error(`TssPlugin.onDKeyGenerate: party not found.`)
      return
    }
    const key = DistributedKey.load(party, _key);
    keysCache.set(key.id, key);
  }

  async tryToRecoverTssKey(partners: MuonNodeInfo[]){
    if(partners.length < this.collateralPlugin.TssThreshold)
      throw {message: "No enough online partners to recover key."};

    let nonce = await this.keyGen(this.tssParty);

    let keyResults = await Promise.all(
      partners.map(p => {
          return this.remoteCall(
            // online partners
            p.peerId,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id},
            {taskId: `keygen-${nonce.id}`}
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
    let reconstructed = tssModule.reconstructKey(shares, this.TSS_THRESHOLD, myIndex)
    // console.log({recon: reconstructed.toString(16)})

    let myKey = tssModule.subKeys(reconstructed, nonce.share)
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
    CoreIpc.fireEvent({type: "tss-key:generate", data: tssKey.toSerializable()});
    log(`${process.pid} tss key recovered`);
    return true;
  }

  async tryToCreateTssKey() {
    while (!this.isReady) {
      try {
        let key;
        do {
          key = await this.keyGen(this.tssParty)
        } while (tssModule.HALF_N.lt(key.getTotalPubKey().x));

        let keyPartners = key.partners.map(id => this.tssParty!.partners[id])
        let callResult = await Promise.all(keyPartners.map(({wallet, peer}) => {
          if (wallet === process.env.SIGN_WALLET_ADDRESS)
            return Promise.resolve(true);
          ;

          return this.remoteCall(
            peer,
            RemoteMethods.storeTssKey,
            {
              party: this.tssParty!.id,
              key: key.id,
            },
            {taskId: `keygen-${key.id}`}
          ).catch(()=>false);
        }))
        // console.log(`key save broadcast count: ${key.partners.length}`, callResult);
        if (callResult.filter(r => r === true).length < this.TSS_THRESHOLD)
          throw `Tss creation failed.`
        this.saveTssConfig(this.tssParty, key)

        keysCache.set(key.id, key, 0);
        this.tssKey = key;
        this.isReady = true;
        CoreIpc.fireEvent({type: "tss-key:generate", data: key.toSerializable()});
        log('tss ready.')

        return key;
      } catch (e) {
        log('error when trying to create tss key %o %o', e, e.stack);
      }
    }
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
      id: id || Party.newId(),
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
    const partnersToCall: MuonNodeInfo[] = partners
      .map(id => this.collateralPlugin.getNodeInfo(id))
      .filter(p => p && !!p.peer)

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
   * @param options.timeout: time need for distributed key generation.
   * @returns {Promise<DistributedKey>}
   */
  async keyGen(party?, options: KeyGenOptions={}): Promise<DistributedKey> {
    if(!party)
      party = this.tssParty;
    if(Object.keys(party.onlinePartners).length < party.t){
      throw {message: "No enough online node."}
    }
    let t0 = Date.now()
    // 1- create new key
    let key = await this.createKey(party, options)
    let t1 = Date.now()
    // 2- distribute key initialization
    await this.broadcastKey(key)
    let t2 = Date.now()
    // 4- calculate distributed key part
    await key.waitToFulfill()
    let t3 = Date.now()
    // 5- TODO: verify commitment
    // key.verifyCommitment(2);
    // console.log('tss-plugin.keyGen', {
    //   t1: t1 - t0,
    //   t2: t2 - t1,
    //   t3: t3 - t2,
    //   total: t3 - t0,
    // })
    CoreIpc.fireEvent({type: "key:generate", data: key.toSerializable()}, {selfEmit: false});
    return key;
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
   * @returns {Promise<DistributedKey>}
   */
  async createKey(party, options: KeyGenOptions={}) {
    let {id, maxPartners, timeout=30000, value} = options;
    // 1- create new key
    let key = new DistributedKey(party, id, timeout, value)
    let taskId = `keygen-${key.id}`;
    let assignResponse = await NetworkIpc.assignTask(taskId);
    if(assignResponse !== 'Ok')
      throw "Cannot assign DKG task to itself."
    /**
     * TODO: check from misbehavior
     * prevent app crash
     */
    key.timeoutPromise.promise.catch(console.error)

    keysCache.set(key.id, key);

    let partners: MuonNodeInfo[] = Object.values(party.onlinePartners)

    if(maxPartners && maxPartners > 0) {
      /** exclude current node and add it later */
      partners = partners.filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS))
      partners = [
        /** self */
        this.currentNodeInfo,
        /** randomly select (maxPartners - 1) from others */
        ...shuffle(partners).slice(0, maxPartners - 1)
      ];
      // console.log(partners)
      // partners = partners.slice(0, maxPartners);
    }

    if(partners.length < party.t) {
      throw {message: "No enough partners for key creation."}
    }

    let callResult = await Promise.all(
      partners
        .map(({peerId, wallet}) => {
          if(wallet === process.env.SIGN_WALLET_ADDRESS)
            return "OK";
          return this.remoteCall(
            peerId,
            RemoteMethods.createKey,
            {
              party: party.id,
              key: key.id,
              value: !!value ? value.toString('hex') : undefined
            },
            {taskId, timeout: 15000}
          ).catch(e => {
            if(process.env.VERBOSE)
              console.log(e)
            return e.message
          })
        })
    )
    // console.log('TssPlugin.createKey '+ key.id, {remoteCallResult: callResult});
    key.partners = partners.filter((p, i) => callResult[i]==='OK').map(p => p.id)
    if(key.partners.length < party.t){
      log('TssPlugin.createKey %o'+ key.id, {remoteCallResult: callResult});
      throw {message: "Error in key creation"}
    }
    return key;
  }

  async broadcastKey(key) {
    // console.log(`broadcasting key shares ...`, key.id)
    key.keyDistributed = true;
    let {party} = key;

    // set key self FH
    let selfWalletIndex = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)!.id;
    let selfFH = key.getFH(selfWalletIndex)
    let A_ik = key.f_x.coefPubKeys()
    key.setSelfShare(selfWalletIndex, selfFH.f, selfFH.h, A_ik);

    // let keyPartners = key.partners.map(w => party.partners[w]);
    const onlinePartners = party.onlinePartners;
    let keyPartners = key.partners.map(id => onlinePartners[id]);
    let distKeyResult = await Promise.all(
      keyPartners
      .map(({wallet, peerId, peer}) => {
        if(wallet === process.env.SIGN_WALLET_ADDRESS)
          return true
        // TODO: sometimes peer is undefined
        if(!peer)
          return 'error';
        // if(!peer){
        //   console.log({wallet, peerId, peer})
        // }
        const destinationNodeInfo = this.collateralPlugin.getNodeInfo(wallet)!;
        return this.remoteCall(
          peerId,
          RemoteMethods.distributeKey,
          {
            party: party.id,
            key: key.id,
            partners: key.partners,
            commitment: key.commitment.map(c => c.encode('hex')),
            pubKeys: A_ik.map(pubKey => pubKey.encode('hex')),
            ...key.getFH(destinationNodeInfo.id),
          },
          {taskId: `keygen-${key.id}`}
        )
          .catch(e => {
            log(`TssPlugin.broadcast to ${peerId} Error %o`, e)
            return 'error'
          });
      }))
    // console.log('TssPlugin.broadcastKey', {distKeyResult})
    return distKeyResult;
  }

  getParty(id) {
    return this.parties[id];
  }

  getSharedKey(id): DistributedKey | undefined {
    return keysCache.get(id);
  }

  async handleBroadcastMessage(msg, callerInfo) {
    let {method, params} = msg;
    // console.log("TssPlugin.handleBroadcastMessage",msg, {callerInfo})
    switch (method) {
      case BroadcastMessage.WhoIsThere: {
        // console.log(`=========== InformEntrance ${wallet}@${peerId} ===========`)
        // TODO: is this message from 'wallet'
        if (!!this.tssParty) {
          const nodeInfo = this.collateralPlugin.getNodeInfo(callerInfo.wallet)!
          this.tssParty.setNodePeer(nodeInfo.id, callerInfo.peerId);
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
    if(!this.tssKey || !this.tssParty){
        throw "Tss not initialized"
    }

    let {tssParty, tssKey} = this

    const callerId = this.collateralPlugin.getNodeInfo(callerInfo.wallet)!.id;
    if (!Object.keys(tssParty.partners).includes(callerId))
      throw `Not included in the global party`;

    let {nonce: nonceId} = data
    if (!!tssKey && nonceId === tssKey.id)
      throw `Cannot use tss key as nonce`;

    let nonce = keysCache.get(nonceId);
    await nonce.waitToFulfill()
    let keyPart = tssModule.addKeys(nonce.share, tssKey.share);
    return {
      id: tssKey.id,
      recoveryShare: `0x${keyPart.toString(16)}`,
      // distributedKey public
      publicKey: `${tssKey.publicKey!.encode('hex', true)}`,
      // distributed key address
      address: tssModule.pub2addr(tssKey.publicKey)
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
   * Before distributing a key information, it must be created on all partners.
   *
   * @param data: key information
   * @param data.party: Party id that new key belongs to.
   * @param data.key: New key id
   * @returns {Promise<boolean>}
   * @private
   */
  @remoteMethod(RemoteMethods.createKey)
  async __createKey(data: {party: string, key: string, value?: string}) {
    // console.log('TssPlugin.__createKey', data)
    let {parties} = this
    let {party, key: keyId} = data
    if (!parties[party]) {
      log('TssPlugin.__createKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (keysCache.has(keyId)) {
      log(`TssPlugin.__createKey>> key already exist [${keyId}]`);
      throw {message: `key already exist [${keyId}]`}
    }
    keysCache.set(keyId, new DistributedKey(parties[party], keyId, undefined, !!data.value ? toBN(data.value) : undefined));
    return "OK";
  }

  /**
   * Handler for key info broadcast.
   *
   * @param data: each partner receive key info
   * @param data.f: total key is sum of this f values.
   * @param data.h: second key used for commitment.
   * @param data.partners: List of wallets of partners that making this key.
   * @param data.keyId: Each key has a unique identifier.
   * @param data.party: Each key belongs to a Party.
   * @param data.commitment: By this commitment current nod can verify {f,h} is generated from unique polynomial.
   *
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<boolean>}
   * @private
   */
  @remoteMethod(RemoteMethods.distributeKey)
  async __distributeKey(data = {}, callerInfo) {
    // console.log('TssPlugin.__distributeKey', data)
    let {parties} = this
    // @ts-ignore
    let {commitment, party, key: keyId, partners, pubKeys, f, h} = data
    if (!parties[party]) {
      log('TssPlugin.__distributeKey>> party not fount on this node id: ' + party)
      throw {message: 'party not found'}
    }
    if (!keysCache.has(keyId)) {
      log('TssPlugin.__distributeKey>> key not fount on this node id: ' + keyId);
      throw {message: 'key not found'}
    }

    let key: DistributedKey = keysCache.get(keyId);
    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())
    commitment = commitment.map(item => tssModule.keyFromPublic(item));

    const currentNodeIndex = this.collateralPlugin.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)!.id;
    const callerIndex = this.collateralPlugin.getNodeInfo(callerInfo.wallet)!.id;
    key.setPartnerShare(currentNodeIndex, callerIndex, partners, f, h, pubKeys, commitment);

    if (!key.keyDistributed) {
      this.broadcastKey(key).catch(console.error);
      /** broadcast to other processes */
      key.waitToFulfill()
        .then(() => {
          CoreIpc.fireEvent({type: "key:generate", data: key.toSerializable()}, {selfEmit: false});
        })
    }
    return true;
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
    let key = this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.__storeTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.__storeTssKey: key not found.'};
    const nodeInfo = this.collateralPlugin.getNodeInfo(callerInfo.wallet)
    if(nodeInfo && nodeInfo.id==LEADER_ID && await this.isNeedToCreateKey()) {
      await key.waitToFulfill()
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      CoreIpc.fireEvent({type: "tss-key:generate", data: key.toSerializable()});
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
    if (!!this.tssParty) {
      const nodeInfo = this.collateralPlugin.getNodeInfo(callerInfo.wallet)!
      this.tssParty.setNodePeer(nodeInfo.id, callerInfo.peerId)
    }
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
