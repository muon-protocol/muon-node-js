import CallablePlugin from '../base/callable-plugin'
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
import Party from './party'
import DistributedKey from "./distributed-key";
const {shuffle} = require('lodash')
import DKey from './distributed-key'
const tssModule = require('../../../utils/tss')
const {utils:{toBN}} = require('web3')
const path = require('path')
const {timeout} = require('../../../utils/helpers');
const {remoteApp, remoteMethod, gatewayMethod, broadcastHandler} = require('../base/app-decorators')
const NodeCache = require('node-cache');
const NetworkingIpc = require('../../../networking/ipc')

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

const BroadcastMessage = {
  WhoIsThere: 'BROADCAST_MSG_WHO_IS_THERE',
};

const RemoteMethods = {
  recoverMyKey: 'recoverMyKey',
  createKey: 'createKey',
  distributeKey: 'distributeKey',
  storeTssKey: 'storeTssKey',
  iAmHere: "iAmHere",
  checkTssStatus: "checkTssStatus",
}

@remoteApp
class TssPlugin extends CallablePlugin {
  isReady = false
  parties = {}
  tssKey: DistributedKey | null = null;
  tssParty: Party | null = null;
  availablePeers = {}

  constructor(...params) {
    // @ts-ignore
    super(...params)
  }

  async onStart() {
    super.onStart();

    this.muon.on('peer:discovery', this.onPeerDiscovery.bind(this));
    this.muon.on('peer:connect', this.onPeerConnect.bind(this));
    this.muon.on('peer:disconnect', this.onPeerDisconnect.bind(this));

    await this.collateralPlugin.waitToLoad()
    this.loadTssInfo();

  }

  async onPeerDiscovery(peerId) {
    // console.log(`[${process.pid}] peer available`, peerId);
    this.availablePeers[peerId] = true
    this.findPeerInfo(peerId);
  }

  async onPeerConnect(peerId) {
    // console.log(`[${process.pid}] peer connected`, peerId)
    this.availablePeers[peerId] = true
    this.findPeerInfo(peerId)
  }

  onPeerDisconnect(disconnectedPeer) {
    // console.log(`[${process.pid}] peer disconnect`, peerId)
    delete this.availablePeers[disconnectedPeer];
    if(this.tssParty){
      // @ts-ignore
      for(let wallet in this.tssParty.partners){
        // @ts-ignore
        let {peerId} = this.tssParty.partners[wallet]
        if(peerId === disconnectedPeer){
          console.log(`TssPlugin: remove online peer ${peerId}`)
          // @ts-ignore
          this.tssParty.setWalletPeer(wallet, null);
          return
        }
      }
    }
  }

  async findPeerInfo(peerId){
    if(!this.collateralPlugin.isLoaded()) {
      return ;
    }
    try {
      let peerWallet = this.collateralPlugin.getPeerWallet(peerId);
      if(peerWallet) {
        if (!!this.tssParty) {
          if (peerWallet) {
            // console.log(`[${process.pid}] TssPlugin: adding online peer`, {peerId, peerWallet})
            // @ts-ignore
            this.tssParty.setWalletPeer(peerWallet, peerId);
          }
        } else {
          console.log(`[${process.pid}] There is no tss party`);
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

  get collateralPlugin() {
    return this.muon.getPlugin('collateral')
  }

  get leaderPlugin() {
    return this.muon.getPlugin('group-leader');
  }

  get GroupAddress() {
    // @ts-ignore
    return this.isReady ? this.tssKey.address : null;
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
    let {groupInfo: {isValid, group, sharedKey, partners}, networkInfo} = this.collateralPlugin;

    //TODO: handle {isValid: false};

    let party = Party.load({
      id: group,
      t: parseInt(networkInfo.tssThreshold),
      max: parseInt(networkInfo.maxGroupSize),
      partners: partners.map(wallet => ({wallet, peerId: this.collateralPlugin.getWalletPeerId(wallet)}))
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
      let key = DKey.load(this.tssParty, _key);
      keysCache.set(key.id, key, 0);
      this.tssKey = key;
      this.isReady = true
      console.log('tss ready');
    }
    else{
      console.log('waiting to leader be selected ...');
      let leader = await NetworkingIpc.getLeader();
      let permitted = await NetworkingIpc.askClusterPermission('tss-key-creation', 20000)
      if(!permitted)
        return;

      if (leader === process.env.SIGN_WALLET_ADDRESS && await this.isNeedToCreateKey()) {
        console.log(`[${process.pid}] got permission to create tss key`);
        let key = await this.tryToCreateTssKey();
        console.log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        await timeout(6000);

        // this.tryToFindOthers();

        while (!this.isReady) {
          await timeout(5000);
          // @ts-ignore
          let onlinePartners = Object.values(this.tssParty.onlinePartners)
          // @ts-ignore
            .filter(({wallet:w}) => w !== process.env.SIGN_WALLET_ADDRESS);

          let statuses = await Promise.all(onlinePartners.map(p => {
            // @ts-ignore
            return this.remoteCall(
                // @ts-ignore
              p.peer,
              RemoteMethods.checkTssStatus
            ).catch(e => 'error')
          }))

          let filter = statuses.map(s => s.isReady)
          onlinePartners = onlinePartners.filter((p, i) => filter[i]);
          statuses = statuses.filter((s, i) => filter[i]);

          if(statuses.length >= this.collateralPlugin.TssThreshold){
            // @ts-ignore
            await this.tryToRecoverTssKey(onlinePartners.map(p => p.wallet));
          }
        }
      }
    }
  }

  async isNeedToCreateKey(){
    let myWallet = process.env.SIGN_WALLET_ADDRESS;
    // @ts-ignore
    let onlinePartners = Object.values(this.tssParty.onlinePartners).filter(p => (p.wallet !== myWallet))
    let statuses = await Promise.all(onlinePartners.map(p => {
      // @ts-ignore
      return this.remoteCall(
          // @ts-ignore
        p.peer,
        RemoteMethods.checkTssStatus
      ).catch(e => 'error')
    }))

    // TODO: is this ok?
    let numReadyNodes = statuses.map(s => (s.isReady?1:0))
    // @ts-ignore
      .reduce((sum, r) => (sum+r), 0);

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
    // console.log('TssPlugin.saveTssConfig', tssConfig);

    // TODO: backup old key >> tss.conf.json.[date:time].bak
    this.muon.backupConfigFile('tss.conf.json');
    // console.log('save config temporarily disabled for test.');
    this.muon.saveConfig(tssConfig, 'tss.conf.json')
  }

  async tryToRecoverTssKey(partners){
    // @ts-ignore
    partners = partners.map(w => this.tssParty.partners[w]);

    if(partners.length < this.collateralPlugin.TssThreshold)
      throw {message: "No enough online partners to recover key."};

    let nonce = await this.keyGen(this.tssParty);

    let keyResults = await Promise.all(
      partners.map(p => {
          return this.remoteCall(
            // online partners
            p.peer,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id},
            {taskId: `keygen-${nonce.id}`}
          ).catch(e => null)
        }
      )
    )
    let shares = partners
      .map((p, j) => {
          if (!keyResults[j])
            return null
          return {
            i: p.wallet,
            key: tssModule.keyFromPrivate(keyResults[j].recoveryShare)
          }
        }
      )
      .filter(s => !!s)
    // @ts-ignore
    if (shares.length < this.tssParty.t) {
      // @ts-ignore
      console.log(`Need's of ${this.tssParty.t} result to recover the Key, but received ${shares.n} result.`)
      return false;
    }

    let myIndex = process.env.SIGN_WALLET_ADDRESS;
    let reconstructed = tssModule.reconstructKey(shares, this.TSS_THRESHOLD, myIndex)
    // console.log({recon: reconstructed.toString(16)})

    let myKey = tssModule.subKeys(reconstructed, nonce.share)
    // console.log({myKey: '0x'+myKey.toString(16)})
    // this.parties[party.id] = party
    let tssKey = DKey.load(this.tssParty, {
      id: keyResults[0].id,
      i: myIndex,
      share: myKey,
      publicKey: tssModule.keyFromPublic(keyResults[0].publicKey),
      address: keyResults[0].address,
    })

    this.tssKey = tssKey
    this.isReady = true;
    this.saveTssConfig(this.tssParty, tssKey)
    console.log('tss key recovered');
    return true;
  }

  async tryToCreateTssKey() {
    // TODO: need to redesign. Now, the executor can loop over the key generation, until it becomes the leader.
    try {
      let key;
      do {
        key = await this.keyGen(this.tssParty)
      } while (tssModule.HALF_N.lt(key.getTotalPubKey().x));

      // @ts-ignore
      let keyPartners = key.partners.map(wallet => this.tssParty.partners[wallet])
      let callResult = await Promise.all(keyPartners.map(({wallet, peer}) => {
        if (wallet === process.env.SIGN_WALLET_ADDRESS)
          return Promise.resolve(true);
        ;

        return this.remoteCall(
          peer,
          RemoteMethods.storeTssKey,
          {
            // @ts-ignore
            party: this.tssParty.id,
            key: key.id,
          },
          {taskId: `keygen-${key.id}`}
        ).catch(() => false);
      }))
      // console.log(`key save broadcast count: ${key.partners.length}`, callResult);
      this.saveTssConfig(this.tssParty, key)

      keysCache.set(key.id, key, 0);
      this.tssKey = key;
      this.isReady = true;
      console.log('tss ready.')

      return key;
    } catch (e) {
      // @ts-ignore
      console.error('TssPlugin.tryToCreateTssKey', e, e.stack);
    }
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
  async keyGen(party, options={}) {
    if(!party)
      party = this.tssParty;
    if(party.onlinePartners.length < this.TSS_THRESHOLD){
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
  async createKey(party, options={}) {
    // @ts-ignore
    let {id, maxPartners, timeout=15} = options;
    // 1- create new key
    let key = new DKey(party, id, 15000)
    let taskId = `keygen-${key.id}`;
    let assignResponse = await NetworkingIpc.assignTask(taskId);
    if(assignResponse !== 'Ok')
      throw "Cannot assign DKG task to itself."
    /**
     * TODO: check from misbehavior
     * prevent app crash
     */
    key.timeoutPromise.promise.catch(console.error)

    keysCache.set(key.id, key);

    let partners = Object.values(party.onlinePartners)

    if(maxPartners && maxPartners > 0) {
      /** exclude current node and add it later */
      // @ts-ignore
      partners = partners.filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS))
      partners = [
        /** self */
        // @ts-ignore
        party.partners[process.env.SIGN_WALLET_ADDRESS],
        /** randomly select (maxPartners - 1) from others */
        ...shuffle(partners).slice(0, maxPartners - 1)
      ];
      // console.log(partners)
      // partners = partners.slice(0, maxPartners);
    }

    if(partners.length < this.TSS_THRESHOLD)
      throw {message: "No enough partners for key creation"}

    let callResult = await Promise.all(
      partners
      // @ts-ignore
        .map(({peer, wallet}) => {
          if(wallet === process.env.SIGN_WALLET_ADDRESS)
            return true;
          return this.remoteCall(
            peer,
            RemoteMethods.createKey,
            {
              party: party.id,
              key: key.id,
              // @ts-ignore
              partners: partners.map(({wallet}) => wallet)
            },
            {taskId, timeout: 15000}
          ).catch(e => 'error')
        })
    )
    // console.log('TssPlugin.createKey '+ key.id, {remoteCallResult: callResult});
    // @ts-ignore
    key.partners = partners.filter((p, i) => callResult[i]!=='error').map(p => p.wallet)
    if(key.partners.length < this.TSS_THRESHOLD){
      console.log('TssPlugin.createKey '+ key.id, {remoteCallResult: callResult});
      throw {message: "Error in key creation"}
    }
    return key;
  }

  async broadcastKey(key) {
    // console.log(`broadcasting key shares ...`, key.id)
    key.keyDistributed = true;
    let {party} = key;

    // set key self FH
    let selfWalletIndex = process.env.SIGN_WALLET_ADDRESS
    let selfFH = key.getFH(selfWalletIndex)
    let A_ik = key.f_x.coefPubKeys()
    key.setSelfShare(selfFH.f, selfFH.h, A_ik);

    let keyPartners = key.partners.map(w => party.partners[w]);
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
        return this.remoteCall(
          peer,
          RemoteMethods.distributeKey,
          {
            party: party.id,
            key: key.id,
            partners: key.partners,
            commitment: key.commitment.map(c => c.encode('hex')),
            pubKeys: A_ik.map(pubKey => pubKey.encode('hex')),
            ...key.getFH(wallet),
          },
          {taskId: `keygen-${key.id}`}
        )
          .catch(e => 'error');
      }))
    // console.log('TssPlugin.broadcastKey', {distKeyResult})
    return distKeyResult;
  }

  getPartyPeers(party) {
    // @ts-ignore
    let partners = Object.values(party.partners).filter(({peerId}) => peerId !== process.env.PEER_ID)
    // @ts-ignore
    let peerIds = partners.map(({peerId}) => peerId)
    return Promise.all(peerIds.map(peerId => this.findPeer(peerId).catch(e => null)))
  }

  getParty(id) {
    return this.parties[id];
  }

  getSharedKey(id) {
    return keysCache.get(id);
  }

  async handleBroadcastMessage(msg, callerInfo) {
    // TODO: use {wallet, peer} from callerInfo instead of msg params.
    let {method, params} = msg;
    // console.log("TssPlugin.handleBroadcastMessage",msg, {callerInfo})
    switch (method) {
      case BroadcastMessage.WhoIsThere: {
        let {peerId} = params;
        // console.log(`=========== InformEntrance ${wallet}@${peerId} ===========`)
        // TODO: is this message from 'wallet'
        if (!!this.tssParty) {
          // @ts-ignore
          this.tssParty.setWalletPeer(callerInfo.wallet, peerId);
          // @ts-ignore
          this.remoteCall(
            peerId,
            RemoteMethods.iAmHere
          ).catch(e => {})
        }
        break;
      }
      default:
        console.log(`unknown message`, msg);
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
  async __recoverMyKey(data = {}, callerInfo) {
    // TODO: can malicious user use a nonce twice?
    // console.log('TssPlugin.__recoverMyKey', data, callerInfo.wallet)
    let {tssParty, tssKey} = this

    // @ts-ignore
    if (!Object.keys(tssParty.partners).includes(callerInfo.wallet))
      return null;

    // @ts-ignore
    let {nonce: nonceId} = data
    // @ts-ignore
    if (!!tssKey && nonceId === tssKey.id)
      return null;

    let nonce = keysCache.get(nonceId);
    await nonce.waitToFulfill()
    // @ts-ignore
    let keyPart = tssModule.addKeys(nonce.share, tssKey.share);
    return {
      // @ts-ignore
      id: tssKey.id,
      recoveryShare: `0x${keyPart.toString(16)}`,
      // distributedKey public
      // @ts-ignore
      publicKey: `${tssKey.publicKey.encode('hex')}`,
      // distributed key address
      // @ts-ignore
      address: tssModule.pub2addr(tssKey.publicKey)
    }
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
  async __createKey(data = {}) {
    // console.log('TssPlugin.__createKey', data)
    let {parties} = this
    // @ts-ignore
    let {party, key: keyId} = data
    if (!parties[party]) {
      console.log('TssPlugin.__createKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (keysCache.has(keyId)) {
      console.log(`TssPlugin.__createKey>> key already exist [${keyId}]`);
      throw {message: `key already exist [${keyId}]`}
    }
    keysCache.set(keyId, new DKey(parties[party], keyId));
    return true;
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
      console.log('TssPlugin.__distributeKey>> party not fount on this node id: ' + party)
      throw {message: 'party not found'}
    }
    if (!keysCache.has(keyId)) {
      console.log('TssPlugin.__distributeKey>> key not fount on this node id: ' + keyId);
      throw {message: 'key not found'}
    }

    let key = keysCache.get(keyId);
    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())
    commitment = commitment.map(item => tssModule.keyFromPublic(item));
    key.setPartnerShare(callerInfo.wallet, partners, f, h, pubKeys, commitment);

    if (!key.keyDistributed) {
      this.broadcastKey(key).catch(console.error);
    }
    return true;
  }

  /**
   * Leader inform other nodes that tss creation completed.
   *
   * @param data
   * @param callerInfo: caller node information
   * @param callerInfo.wallet: collateral wallet of caller node
   * @param callerInfo.peerId: PeerID of caller node
   * @returns {Promise<boolean>}
   * @private
   */
  @remoteMethod(RemoteMethods.storeTssKey)
  async __storeTssKey(data = {}, callerInfo) {
    // TODO: problem condition: request arrive when tss is ready
    // console.log('TssPlugin.__storeTssKey', data)
    // @ts-ignore
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key = this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.__storeTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.__storeTssKey: key not found.'};
    let leader = await NetworkingIpc.getLeader();
    if(await this.isNeedToCreateKey() && leader === callerInfo.wallet) {
      await key.waitToFulfill()
      this.saveTssConfig(party, key);
      this.tssKey = key
      this.isReady = true;
      console.log('save done')
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
      // @ts-ignore
      this.tssParty.setWalletPeer(callerInfo.wallet, callerInfo.peerId)
    }
  }

  @remoteMethod(RemoteMethods.checkTssStatus)
  async __checkTssStatus(data={}, callerInfo) {
    return {
      isReady: this.isReady,
      // @ts-ignore
      address: this.tssKey?.address,
    }
  }
}

export default TssPlugin;
