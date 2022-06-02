const CallablePlugin = require('../base/callable-plugin')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const Party = require('./party')
const {shuffle} = require('lodash')
const DKey = require('./distributed-key')
const tssModule = require('../../utils/tss')
const {toBN} = require('../../utils/tss/utils')
const path = require('path')
const {timeout} = require('../../utils/helpers');
const {remoteApp, remoteMethod, gatewayMethod} = require('../base/app-decorators')
const NodeCache = require('node-cache');

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
  NeedGroup: 'BROADCAST_MSG_NEED_GROUP',
  JoinedToGroup: 'BROADCAST_MSG_JOINED_TO_GROUP',
  JoinPartyRequest: 'BROADCAST_MSG_JOIN_PARTY_REQ',
  WhoIsThere: 'BROADCAST_MSG_WHO_IS_THERE',
};

const RemoteMethods = {
  joinToParty: 'joinToParty',
  setPartners: 'setPartners',
  addNewPartner: 'addNewPartner',
  recoverMyKey: 'recoverMyKey',
  createKey: 'createKey',
  distributeKey: 'distributeKey',
  distributePubKey: 'distributePubKey',
  storeTssKey: 'storeTssKey',
  iAmHere: "iAmHere",
  checkTssStatus: "checkTssStatus",
}

const GroupStatus = {
  Initial: 0,
  Checking: 1,
  ReadyToJoin: 2,
  Joining: 3,
  Joined: 4,
}

@remoteApp
class TssPlugin extends CallablePlugin {

  groupStatus = GroupStatus.Initial;
  joiningTssGroup = null
  isReady = false
  parties = {}
  tssKey = null;
  tssParty = null;

  nodesNeedGroup = {}

  constructor(...params) {
    super(...params)
  }

  async onStart() {
    super.onStart();

    this.collateralPlugin.once('loaded', async () => {
      /**
       * Normally, broadcast subscription will done inside the super.onStart().
       * But, at the start time, BROADCAST_CHANNEL has a null value and while BROADCAST_CHANNEL is null, subscription will ignored.
       * So, now that BROADCAST_CHANNEL has a value, we call registerBroadcastHandler again to subscribe to group channel.
       */
      await this.registerBroadcastHandler();

      this.loadTssInfo();

      // this.collateralPlugin.onEvent('AddPartner', txs => console.log('AddPartner....', txs))
    })

    this.muon.on('peer:disconnect', this.onPeerDisconnect.bind(this));
  }

  onPeerDisconnect(peer) {
    if(this.isReady){
      for(let wallet in this.tssParty.partners){
        let {peerId} = this.tssParty.partners[wallet]
        if(peerId === peer._idB58String){
          console.log(`TssPlugin: remove online peer ${peerId}`)
          this.tssParty.setWalletPeer(wallet, null);
          return
        }
      }
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

    this.emit('party-load');

    this.tryToFindOthers(3);

    // validate tssConfig
    let tssConfig = this.getTssConfig();

    if(tssConfig){
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
      let leader = await this.leaderPlugin.waitToLeaderSelect();

      if (leader === process.env.SIGN_WALLET_ADDRESS && await this.isNeedToCreateKey()) {
        let key = await this.tryToCreateTssKey();
        console.log(`TSS key generated with ${key.partners.length} partners`);
      }
      else{
        await timeout(6000);

        this.tryToFindOthers();

        while (!this.isReady) {
          await timeout(5000);
          let onlinePartners = Object.values(this.tssParty.onlinePartners)
            .filter(({wallet:w}) => w !== process.env.SIGN_WALLET_ADDRESS);

          let statuses = await Promise.all(onlinePartners.map(p => {
            return this.remoteCall(
              p.peer,
              RemoteMethods.checkTssStatus
            ).catch(e => 'error')
          }))

          let filter = statuses.map(s => s.isReady)
          onlinePartners = onlinePartners.filter((p, i) => filter[i]);
          statuses = statuses.filter((s, i) => filter[i]);

          if(statuses.length >= this.collateralPlugin.TssThreshold){
            await this.tryToRecoverTssKey(onlinePartners.map(p => p.wallet));
          }
        }
      }
    }
  }

  async isNeedToCreateKey(){
    let myWallet = process.env.SIGN_WALLET_ADDRESS;
    let onlinePartners = Object.values(this.tssParty.onlinePartners).filter(p => (p.wallet !== myWallet))
    let statuses = await Promise.all(onlinePartners.map(p => {
      return this.remoteCall(
        p.peer,
        RemoteMethods.checkTssStatus
      ).catch(e => 'error')
    }))

    // TODO: is this ok?
    let numReadyNodes = statuses.map(s => (s.isReady?1:0))
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

  informJoinedToGroup() {
    this.broadcast({
      method: BroadcastMessage.JoinedToGroup,
      params: {
        peerId: process.env.PEER_ID,
        wallet: process.env.SIGN_WALLET_ADDRESS,
      }
    })
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
            {nonce: nonce.id,}
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
    if (shares.length < this.tssParty.t) {
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
    try {

      let key;
      do {
        key = await this.keyGen(this.tssParty)
      } while (tssModule.HALF_N.lt(key.getTotalPubKey().x));

      let keyPartners = key.partners.map(wallet => this.tssParty.partners[wallet])
      let callResult = await Promise.all(keyPartners.map(({wallet, peer}) => {
        if (wallet === process.env.SIGN_WALLET_ADDRESS)
          return Promise.resolve(true);
        ;

        return this.remoteCall(
          peer,
          RemoteMethods.storeTssKey,
          {
            party: this.tssParty.id,
            key: key.id,
          }
        ).catch(() => false);
      }))
      // console.log(`key save broadcast count: ${key.partners.length}`, callResult);
      this.saveTssConfig(this.tssParty, key)

      keysCache.set(key.id, key, 0);
      this.tssKey = key;
      this.isReady = true;
      this.informJoinedToGroup();
      console.log('tss ready.')

      return key;
    } catch (e) {
      console.error('TssPlugin.tryToCreateTssKey', e, e.stack);
    }
  }

  /**
   *
   * @param party
   * @param options
   * @param options.id: create key with specific id
   * @param options.maxPartners: create key that shared with at most `maxPartners` participants.
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
    let {id, maxPartners} = options;
    // 1- create new key
    let key = new DKey(party, id, 15000)
    /**
     * TODO: check from misbehavior
     * prevent app crash
     */
    key.timeoutPromise.promise.catch(console.error)

    keysCache.set(key.id, key);

    let partners = Object.values(party.onlinePartners)

    if(maxPartners && maxPartners > 0) {
      /** exclude current node and add it later */
      partners = partners.filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS))
      partners = [
        /** self */
        party.partners[process.env.SIGN_WALLET_ADDRESS],
        /** randomly select (maxPartners - 1) from others */
        ...shuffle(partners).slice(0, maxPartners - 1)
      ];
      // console.log(partners)
      // partners = partners.slice(0, maxPartners);
    }

    let callResult = await Promise.all(
      partners
        .map(({peer, wallet}) => {
          if(wallet === process.env.SIGN_WALLET_ADDRESS)
            return true;
          return this.remoteCall(
            peer,
            RemoteMethods.createKey,
            {
              party: party.id,
              key: key.id,
              partners: partners.map(({wallet}) => wallet)
            }
          ).catch(e => 'error')
        })
    )
    // console.log('TssPlugin.createKey '+ key.id, {remoteCallResult: callResult});
    key.partners = partners.filter((p, i) => callResult[i]!=='error').map(p => p.wallet)
    return key;
  }

  async broadcastKey(key) {
    // console.log(`broadcasting key shares ...`, key.id)
    key.keyDistributed = true;
    let {party} = key;

    // set key self FH

    let selfWalletIndex = process.env.SIGN_WALLET_ADDRESS

    let selfFH = key.getFH(selfWalletIndex)
    key.setFH(selfWalletIndex, selfFH.f, selfFH.h);
    let A_ik = key.f_x.coefficients.map(a_k => a_k.getPublic())
    key.setParticipantPubKeys(selfWalletIndex, A_ik)

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
            from: process.env.SIGN_WALLET_ADDRESS,
            party: party.id,
            key: key.id,
            partners: key.partners,
            commitment: key.commitment.map(c => c.serialize()),
            walletIndex: wallet,
            pubKeys: A_ik.map(pubKey => pubKey.encode('hex')),
            ...key.getFH(wallet),
          }
        )
          .catch(e => 'error')
      }))
    // console.log('TssPlugin.broadcastKey', {distKeyResult})
    return distKeyResult;
  }

  getPartyPeers(party) {
    let partners = Object.values(party.partners).filter(({peerId}) => peerId !== process.env.PEER_ID)
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
      case BroadcastMessage.NeedGroup: {
        let {peerId} = params;
        let {wallet} = callerInfo
        this.nodesNeedGroup[wallet] = {peerId, wallet};
        // console.log({nodesNeedGroup: Object.keys(this.nodesNeedGroup)})
        break;
      }
      case BroadcastMessage.JoinedToGroup: {
        let {wallet} = callerInfo;
        delete this.nodesNeedGroup[wallet];
        // console.log({nodesNeedGroup: Object.keys(this.nodesNeedGroup)})
        break;
      }
      case BroadcastMessage.JoinPartyRequest: {
        if (this.groupStatus !== GroupStatus.ReadyToJoin)
          return;
        let {id, peerId} = params;
        /**
         * Join to the group with lower id, on concurrent request.
         * Ignore if id is grater than current group id.
         */
        if (!!this.joiningTssGroup && id > this.joiningTssGroup)
          return;
        console.log(`joining to group ${id}`)
        this.joiningTssGroup = id;
        if(this.clearTimeout)
          clearTimeout(this.clearTimeout);
        this.clearTimeout = setTimeout(() => {
          this.clearTimeout = null;
          this.joiningTssGroup = null
        }, 18000)
        let peer = await this.findPeer(peerId)
        await this.remoteCall(
          peer,
          RemoteMethods.joinToParty,
          {
            id,
            peerId: process.env.PEER_ID,
            wallet: process.env.SIGN_WALLET_ADDRESS
          }
        )
        break
      }
      case BroadcastMessage.WhoIsThere: {
        let {peerId} = params;
        // console.log(`=========== InformEntrance ${wallet}@${peerId} ===========`)
        // TODO: is this message from 'wallet'
        let peer = await this.findPeer(peerId);
        if (!!this.tssParty) {
          this.tssParty.setWalletPeer(callerInfo.wallet, peer);
          this.remoteCall(
            peer,
            RemoteMethods.iAmHere
          ).catch(e => {})
        }
        break;
      }
      default:
        console.log(`unknown message`, msg);
    }
  }

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
  @remoteMethod(RemoteMethods.joinToParty)
  async __joinToParty(data = {}) {
    // console.log('TssPlugin.__joinToParty', data)
    let {id, peerId, wallet} = data
    let party = this.parties[id];
    if (party && !party.isFulfilled()) {
      this.parties[id].addPartner({peerId, wallet})
    }
    // else{
    // console.log(`party ${id} full filled ignoring peer join ${peerId}`)
    // }
  }

  @remoteMethod(RemoteMethods.setPartners)
  async __setPartners(data = {}) {
    // console.log('TssPlugin.__setPartners', data)
    let {id, t, max, partners, config} = data;
    if (!this.joiningTssGroup || this.joiningTssGroup !== id)
      throw {message: `Create group with id ${id} not allowed.`}
    if (!this.parties[id])
      this.parties[id] = new Party(t, max, id)
    Object.values(partners).map(p => {
      this.parties[id].addPartner(p)
    })
    let peers = await this.getPartyPeers(this.parties[id])
    this.parties[id].setPeers(peers)
    // TODO: check here
    // if (config.isTssParty) {
      this.tssParty = this.parties[id]
    // }
    this.groupStatus = GroupStatus.Joined;
    // this.joiningTssGroup = null;
    console.log('joined to group');
  }

  @remoteMethod(RemoteMethods.addNewPartner)
  async __addNewPartner(data = {}, callerInfo) {
    // console.log('TssPlugin.__addNewPartner', data, callerInfo)
    let {party: partyId} = data;
    let {tssParty, tssKey} = this;
    if (tssParty.id !== partyId) {
      return false;
    }

    /**
     * if already in group
     */
    // if (!!tssParty.partners[callerInfo.wallet]) {
    //   return tssParty.partners[callerInfo.wallet].id === partner.id;
    // }

    /**
     * cannot assign other's id
     */
    // let idIsInUse = Object.values(tssParty.partners).findIndex(p => (p.id === partner.id)) >= 0;
    // if (partner.id < 1 || idIsInUse)
    //   return false;

    tssParty.addPartner({wallet: callerInfo.wallet, peerId: callerInfo.peerId.toB58String()});
    let peer = await this.findPeer(callerInfo.peerId)
    tssParty.setPeers([peer])
    this.saveTssConfig(tssParty, tssKey);
    console.log('new partner added.')
    return true;
  }

  @remoteMethod(RemoteMethods.recoverMyKey)
  async __recoverMyKey(data = {}, callerInfo) {
    // console.log('TssPlugin.__recoverMyKey', data, callerInfo.wallet)
    let {tssParty, tssKey} = this

    if (!Object.keys(tssParty.partners).includes(callerInfo.wallet))
      return null;

    let {nonce: nonceId} = data
    if (!!tssKey && nonceId === tssKey.id)
      return null;

    let nonce = keysCache.get(nonceId);
    await nonce.waitToFulfill()
    let keyPart = tssModule.addKeys(nonce.share, tssKey.share);
    return {
      id: tssKey.id,
      recoveryShare: `0x${keyPart.toString(16)}`,
      // distributedKey public
      publicKey: `${tssKey.publicKey.encode('hex')}`,
      // distributed key address
      address: tssModule.pub2addr(tssKey.publicKey)
    }
  }

  @remoteMethod(RemoteMethods.createKey)
  async __createKey(data = {}) {
    // console.log('TssPlugin.__createKey', data)
    let {parties} = this
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

  @remoteMethod(RemoteMethods.distributeKey)
  async __distributeKey(data = {}) {
    // console.log('TssPlugin.__distributeKey', data)
    let {parties} = this
    let {from, commitment, party, key: keyId, partners, pubKeys, f, h} = data
    if (!parties[party]) {
      console.log('TssPlugin.__distributeKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (!keysCache.has(keyId)) {
      console.log('TssPlugin.__distributeKey>> key not fount on this node id: ' + keyId);
      throw {message: 'key not found'}
    }

    let key = keysCache.get(keyId);
    key.partners = partners

    key.setFH(from, f, h)
    key.setParticipantCommitment(from, commitment)

    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())
    key.setParticipantPubKeys(from, pubKeys)

    if (!key.keyDistributed) {
      this.broadcastKey(key).catch(console.error);
    }
    return true;
  }

  @remoteMethod(RemoteMethods.distributePubKey)
  async __distributePubKey(data = {}) {
    // console.log('__distributePubKey', data.from)
    let {parties} = this
    let {from, party, key: keyId, pubKeys} = data
    if (!parties[party]) {
      console.error('TssPlugin.__distributePubKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (!keysCache.has(keyId)) {
      console.error('TssPlugin.__distributePubKey>> distributed key not found')
      throw {message: 'distributed key not found'}
    }
    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())

    let key = keysCache.get(keyId)
    key.setParticipantPubKeys(from, pubKeys)
  }

  @remoteMethod(RemoteMethods.storeTssKey)
  async __storeTssKey(data = {}) {
    // TODO: problem condition: request arrive when tss is ready
    // console.log('TssPlugin.__storeTssKey', data)
    let {party: partyId, key: keyId} = data
    let party = this.getParty(partyId)
    let key = this.getSharedKey(keyId);
    if (!party)
      throw {message: 'TssPlugin.__storeTssKey: party not found.'}
    if (!key)
      throw {message: 'TssPlugin.__storeTssKey: key not found.'}
    await key.waitToFulfill()
    this.saveTssConfig(party, key);
    this.tssKey = key
    this.isReady = true;
    this.informJoinedToGroup()
    console.log('save done')
    return true;
  }

  @remoteMethod(RemoteMethods.iAmHere)
  async __iAmHere(data={}, callerInfo) {
    // console.log('TssPlugin.__iAmHere', data)
    let peer = await this.findPeer(callerInfo.peerId);
    if (!!this.tssParty) {
      this.tssParty.setWalletPeer(callerInfo.wallet, peer)
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

module.exports = TssPlugin;
