const CallablePlugin = require('../base/callable-plugin')
const Party = require('./party')
const DKey = require('./distributed-key')
const tssModule = require('../../utils/tss')
const {toBN} = require('../../utils/tss/utils')
const path = require('path')
const {timeout} = require('../../utils/helpers');
const {remoteMethod, gatewayMethod} = require('../base/app-decorators')

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

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

class TssPlugin extends CallablePlugin {

  groupStatus = GroupStatus.Initial;
  joiningTssGroup = null
  isReady = false
  parties = {}
  keys = {}
  tssKey = null;
  tssParty = null;

  nodesNeedGroup = {}

  constructor(...params) {
    super(...params)
  }

  get BROADCAST_CHANNEL() {
    let baseChannel = super.BROADCAST_CHANNEL;
    if (!!this.collateralPlugin.GroupId)
      return `${baseChannel}/group_${this.collateralPlugin.GroupId}`;
    else
      return null;
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
  }

  // TODO: remove this and replace all usage with collateral-info-plugin.TssThreshold
  get TSS_THRESHOLD() {
    return this.collateralPlugin.TssThreshold;
  }

  // TODO: remove this and replace all usage with collateral-info-plugin.MaxGroupSize
  get TSS_MAX() {
    return this.collateralPlugin.MaxGroupSize;
  }

  get collateralPlugin() {
    return this.muon.getPlugin('collateral')
  }

  get leaderPlugin() {
    return this.muon.getPlugin('group-leader');
  }

  get networkStatus() {
    return this.muon.getPlugin('network-status');
  }

  get GroupAddress() {
    return this.isReady ? this.tssKey.address : null;
  }

  async joinToGroup() {
    this.informEntrance();
    try {
      /**
       * check and load previews tss config.
       */
      let loadedFromStorage = await this.loadSavedTss()
      if (loadedFromStorage) {
        console.log('tss loaded from storage.')
        return true
      }
    } catch (e) {
      console.error('TssPlugin.joinToGroup', e, e.stack)
    }

    while (!this.isReady) {
      try {
        // TODO: check this field changes.
        // this.groupStatus = GroupStatus.Checking;

        let joinedToExistingGroup = await this.tryToJoinExistingGroup(3)
        if (joinedToExistingGroup) {
          console.log('tss joined to existing group.');
          break;
        }

        if (this.isReady)
          break;
        this.informNeedGroup();

        // TODO: check this field changes.
        this.groupStatus = GroupStatus.ReadyToJoin;

        /**
         * if previews config cannot be loaded, create and save new one
         */
        await this.tryToCreateTssKey(15);
      } catch (e) {
        console.error('TssPlugin.joinToGroup', e, e.stack);
      }
    }

    this.groupStatus = GroupStatus.Joined;
  }

  getTssConfig(){
    let {tss: tssConfig} = this.muon.configs;
    let {Network, TssThreshold, GroupManagerAddress, GroupId} = this.collateralPlugin;
    // console.log({tssConfig})

    if(!tssConfig)
      return null;

    if(
      tssConfig.group?.id != GroupId
      || tssConfig.group.t != TssThreshold
      || tssConfig.group.network !== Network
      || tssConfig.group.collateral != GroupManagerAddress
    ) {
      return null;
    }

    return tssConfig;
  }

  async loadTssInfo() {
    let {groupInfo: {isValid, group, sharedKey, partners}, networkInfo} = this.collateralPlugin;

    //TODO: handle {isValid: false}

    let party = Party.load({
      id: group,
      t: parseInt(networkInfo.tssThreshold),
      max: parseInt(networkInfo.maxGroupSize),
      partners: partners.map(wallet => ({wallet}))
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
      this.keys[key.id] = key;
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

  async loadSavedTss() {
    let {tss: tssConfig, account} = this.muon.configs;
    if (!tssConfig || tssConfig.party.t !== this.TSS_THRESHOLD)
      return false
    // load party
    let party = Party.load(tssConfig.party);
    this.parties[party.id] = party

    let _key = {
      ...tssConfig.key,
      share: toBN(tssConfig.key.share),
      publicKey: tssModule.keyFromPublic(tssConfig.key.publicKey)
    }
    let key = DKey.load(party, _key)
    this.keys[key.id] = key;
    // let party = new Party(_party.t, _party.max, _party.id)
    // load distributed key
    // console.dir({tssConfig}, {depth: null})
    this.tssParty = party;
    this.tssKey = key;
    this.isReady = true
    return true;
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

  informNeedGroup() {
    this.broadcast({
      method: BroadcastMessage.NeedGroup,
      params: {
        peerId: process.env.PEER_ID,
        wallet: process.env.SIGN_WALLET_ADDRESS,
      }
    })
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
      group: {
        id: this.collateralPlugin.GroupId,
        t: this.collateralPlugin.TssThreshold,
        network: this.collateralPlugin.Network,
        collateral: this.collateralPlugin.GroupManagerAddress,
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
    // TODO: backup previews key.

    // console.log('save config temporarily disabled for test.', tssConfig)
    // this.muon.saveConfig(tssConfig, `tss.conf.json`);
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

  async tryToJoinExistingGroup(numTry = 10) {
    let partyToJoin = await this.muon.getPlugin('tss-party-search').searchParty(numTry);
    // console.log({partyToJoin})
    if (!partyToJoin)
      return false
    let party = Party.load(partyToJoin);
    try {
      let peers = await this.getPartyPeers(party);
      party.setPeers(peers);
    } catch (e) {
      console.log('TssPlugin.tryToJoinExistingGroup', e)
      return false;
    }

    // TODO: ignore addNewPartner if already added
    let onlinePartners = Object.values(party.partners).filter(p => !!p.peer);
    if (Object.keys(party.partners).includes(process.env.SIGN_WALLET_ADDRESS)) {
      console.log('already in party')
    } else {
      let partnersMaxId = Object.values(party.partners).reduce((max, p) => Math.max(max, p.i), 0);
      let newPartnerInfo = {
        // max( ...partners.id ) + 1
        id: partnersMaxId + 1,
        wallet: process.env.SIGN_WALLET_ADDRESS,
        peerId: process.env.PEER_ID
      }
      let addResults = await this.remoteCall(
        // online partners
        onlinePartners.map(p => p.peer),
        RemoteMethods.addNewPartner,
        {
          party: party.id,
          partner: newPartnerInfo
        }
      )
      console.log({addResults})
      let numNodeAdded = addResults.map(added => added ? 1 : 0).reduce((acc, a) => acc + a, 0);
      /**
       * if sufficient nodes accepted current node address
       */
      if (numNodeAdded < this.TSS_THRESHOLD) {
        console.log('cannot join to existing group.')
        return false
      }

      party.addPartner(newPartnerInfo);
    }

    this.parties[party.id] = party;
    this.tssParty = party;
    let nonce = await this.keyGen(party);

    let keyResults = await Promise.all(
      onlinePartners.map(p => {
          return this.remoteCall(
            // online partners
            p.peer,
            RemoteMethods.recoverMyKey,
            {nonce: nonce.id,}
          ).catch(e => null)
        }
      )
    )
    let shares = onlinePartners
      .map((p, j) => {
          if (!keyResults[j])
            return null
          return {
            i: p.i,
            key: tssModule.keyFromPrivate(keyResults[j].recoveryShare)
          }
        }
      )
      .filter(s => !!s)
    if (shares.length < party.t) {
      console.log(`Need's of ${party.t} result to recover the Key, but received ${shares.n} result.`)
      return false;
    }

    let myIndex = party.partners[process.env.SIGN_WALLET_ADDRESS].i;
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

      this.keys[key.id] = key;
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
   * This makes a group of nodes that will works together in order to make Key/Signature.
   * @param t: number of nodes needed to reconstruct shared key.
   * @returns {Promise<TssParty|null>}
   */
  async makeParty(t = 2, options) {
    // TODO: redesign this method
    // let party = await this._makeNewParty(2);
    // const peers = await this.getPartyPeers(party)
    // party.setPeers(peers)
    // await this.initParty(party)
    let {peers: defaultPeers, config} = options

    if (this.joiningTssGroup)
      throw {message: 'Already joining to group'};

    let party = new Party(t, this.TSS_MAX, null, 15000);
    this.newParty = party;
    this.parties[party.id] = party;
    this.joiningTssGroup = party.id;

    if (defaultPeers) {
      // TODO: not implemented
      throw {message: "not implemented"};
    } else {
      this.broadcast({
        method: BroadcastMessage.JoinPartyRequest,
        params: {
          id: party.id,
          peerId: process.env.PEER_ID,
          wallet: process.env.SIGN_WALLET_ADDRESS,
        }
      })
      await party.waitToFulfill()
    }

    if (this.joiningTssGroup !== party.id)
      throw {message: 'Joined to remote party'}

    if (!party.hasEnoughPartners()) {
      delete this.parties[party.id]
      this.joiningTssGroup = null;
      throw {message: `Need to ${party.t} partners, but ${Object.keys(party.partners).length} partner joined after 5 seconds.`}
    }

    // let partners = Object.values(party.partners).filter(({peerId}) => peerId != process.env.PEER_ID)
    // let peers = await Promise.all(partners.map(({peerId}) => this.findPeer(peerId)))
    let peers = await this.getPartyPeers(party);
    party.setPeers(peers);

    await this.remoteCall(
      peers,
      RemoteMethods.setPartners,
      {
        id: party.id,
        t: party.t,
        max: party.max,
        partners: party.partners,
        config,
      }
    )
    return party;
  }

  async keyGen(party, id) {
    if(!party)
      party = this.tssParty;

    let t0 = Date.now()
    // 1- create new key
    let key = await this.createKey(party, id)
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

  async createKey(party, id=null) {
    // 1- create new key
    let key = new DKey(party, id, 5000)
    /**
     * TODO: check from misbehavior
     * prevent app crash
     */
    key.timeoutPromise.promise.catch(console.error)

    this.keys[key.id] = key;

    let partners = Object.values(party.onlinePartners)

    let callResult = await Promise.all(
      partners
        .map(({peer, wallet}) => {
          if (wallet === process.env.SIGN_WALLET_ADDRESS)
            return true;
          return this.remoteCall(
            peer,
            RemoteMethods.createKey,
            {
              party: party.id,
              key: key.id,
              partners: partners.map(p => p.wallet)
            }
          ).catch(e => 'error')
        })
    )
    // console.log('TssPlugin.createKey '+ key.id, {remoteCallResult: callResult});
    key.partners = partners.filter((p, i) => callResult[i] !== 'error').map(p => p.wallet)
    return key;
  }

  getNodesWalletIndex(party) {
    return party.walletIndexes
  }

  async broadcastKey(key, peerIds) {
    // console.log(`broadcasting key shares ...`, key.id)
    key.keyDistributed = true;
    let {party} = key;
    // let walletIndexes = this.muon.getNodesWalletIndex();
    let walletIndexes = party.walletIndexes;

    // set key self FH

    let selfWalletIndex = walletIndexes[process.env.SIGN_WALLET_ADDRESS]
    if (!selfWalletIndex) {
      console.log({walletIndexes})
    }

    let selfFH = key.getFH(selfWalletIndex)
    key.setFH(selfWalletIndex, selfFH.f, selfFH.h);
    let A_ik = key.f_x.coefficients.map(a_k => a_k.getPublic())
    key.setParticipantPubKeys(selfWalletIndex, A_ik)

    // update peers that is'nt connected.
    if (peerIds) {
      let partnersWithoutPeer = key.partners.filter(w => {
        return w !== process.env.SIGN_WALLET_ADDRESS && !party.partners[w].peer
      })

      let peers = await Promise.all(partnersWithoutPeer.map(w => this.findPeer(peerIds[w]).catch(e => null)))
      if (peers.includes(null)) {
        throw {message: 'peer not found to broadcast'}
      }
      partnersWithoutPeer.map((w, i) => {
        party.setWalletPeer(w, peers[i]);
      })
    }

    let keyPartners = key.partners.map(w => party.partners[w]);
    // // TODO: Debug part remove it in production, or be sure that, DEBUG env variable is cleared.
    if(process.env.DEBUG) {
      /**
       * It makes a random delay in key generation process.
       * It is helpful when you run a local dev network.
       */
      if(!!peerIds)
        await timeout(Math.floor(Math.random()*2500));
    }
    let distKeyResult = await Promise.all(
      keyPartners
        .map(({wallet, peer}) => {
          if (wallet === process.env.SIGN_WALLET_ADDRESS)
            return true
          // TODO: sometimes peer is undefined. when two of nodes (other than first node) not connected to each other.
          if (!peer) {
            console.log('TssPlugin.broadcastKey: peer not found', {wallet})
            return 'error';
          }
          let walletIndex = walletIndexes[wallet]
          return this.remoteCall(
            peer,
            RemoteMethods.distributeKey,
            {
              from: process.env.SIGN_WALLET_ADDRESS,
              party: party.id,
              key: key.id,
              partners: key.partners.reduce((obj, w) => {
                obj[w] = w === process.env.SIGN_WALLET_ADDRESS ? process.env.PEER_ID : party.partners[w].peer.id.toB58String()
                return obj;
              }, {}),
              commitment: key.commitment.map(c => c.serialize()),
              walletIndex,
              pubKeys: A_ik.map(pubKey => pubKey.encode('hex')),
              ...key.getFH(walletIndex),
            }
          )
            .catch(e => 'error')
        }))
    // TODO: Does need to verify other nodes broadcast. currently other nodes may fail to broadcast the key.
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
    return this.keys[id];
  }

  async hash(msg, party) {
  }

  async sign(hash, party, nonce) {
    console.log({
      ...nonce,
      keyPart: nonce.keyPart.toString(),
      pubKey: {
        x: nonce.pubKey.x.toString(),
        y: nonce.pubKey.y.toString(),
      }
    })
  }

  async verify(hash, sign) {
  }

  async handleBroadcastMessage(msg, callerInfo) {
    let {method, params} = msg;
    // console.log('tss-plugin.handleBroadcastMessage', msg);
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
        if (this.clearTimeout)
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
        let peer = await this.findPeer(peerId);
        if (!!this.tssParty) {
          this.tssParty.setWalletPeer(callerInfo.wallet, peer);
          this.remoteCall(
            peer,
            RemoteMethods.iAmHere
          ).catch(e => {
          })
        }
        break;
      }
      default:
        console.log(`unknown message`, msg);
    }
  }

  async onBroadcastReceived(data={}, callerInfo) {
    try {
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
  async __joinToParty(data = {}, callerInfo) {
    // console.log('TssPlugin.__joinToParty', data)
    let {id} = data
    let {peerId, wallet} = callerInfo;
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
    // console.log('TssPlugin.__addNewPartner', data)
    let {party: partyId, partner} = data;
    let {tssParty, tssKey} = this;
    if (tssParty.id !== partyId) {
      return false;
    }

    /**
     * nodes can't add other wallet
     */
    if (callerInfo.wallet !== partner.wallet)
      return false;

    /**
     * if already in group
     */
    if (!!tssParty.partners[partner.wallet]) {
      return tssParty.partners[partner.wallet].id === partner.id;
    }

    /**
     * cannot assign other's id
     */
    let idIsInUse = Object.values(tssParty.partners).findIndex(p => (p.id === partner.id)) >= 0;
    if (partner.id < 1 || idIsInUse)
      return false;

    tssParty.addPartner(partner);
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

    let nonce = this.keys[nonceId]
    await nonce.waitToFulfill();
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
  async __createKey(data = {}, callerInfo) {
    // console.log('TssPlugin.__createKey', callerInfo.wallet, data);
    let {parties, keys} = this
    let {party, key} = data;
    if (!parties[party]) {
      console.log('TssPlugin.__createKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (!!keys[key]) {
      console.log(`TssPlugin.__createKey>> key already exist [${key}]`);
      throw {message: `key already exist [${key}]`}
    }
    keys[key] = new DKey(parties[party], key);
    return true;
  }

  @remoteMethod(RemoteMethods.distributeKey)
  async __distributeKey(data = {}, callerInfo) {
    // console.log('TssPlugin.__distributeKey', {from: data.from})
    let {parties, keys} = this
    let {from, commitment, party, key, partners, pubKeys, f, h} = data
    if (!parties[party]) {
      console.log('TssPlugin.__distributeKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (!keys[key]) {
      console.log('TssPlugin.__distributeKey>> key not fount on this node id: ' + key);
      throw {message: 'key not found'}
    }
    keys[key].partners = Object.keys(partners);

    // let fromIndex = this.muon.getNodesWalletIndex()[from]
    let fromIndex = parties[party].walletIndexes[from]
    keys[key].setFH(fromIndex, f, h)
    keys[key].setParticipantCommitment(fromIndex, commitment)

    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())
    keys[key].setParticipantPubKeys(fromIndex, pubKeys)

    if (!keys[key].keyDistributed) {
      this.broadcastKey(keys[key], partners).catch(console.error);
    }
    return true;
  }

  @remoteMethod(RemoteMethods.distributePubKey)
  async __distributePubKey(data = {}) {
    console.log('__distributePubKey', data.from)
    let {parties, keys} = this
    let {from, party, key, pubKeys} = data;
    if (!parties[party]) {
      console.error('TssPlugin.__distributePubKey>> party not fount on this node id: ' + party);
      throw {message: 'party not found'}
    }
    if (!keys[key]) {
      console.error('TssPlugin.__distributePubKey>> distributed key not found')
      throw {message: 'distributed key not found'}
    }
    // let fromIndex = this.getNodesWalletIndex(parties[party])[from]
    let fromIndex = parties[party].walletIndexes[from]
    pubKeys = pubKeys.map(pub => tssModule.curve.keyFromPublic(pub, 'hex').getPublic())
    keys[key].setParticipantPubKeys(fromIndex, pubKeys)
  }

  @remoteMethod(RemoteMethods.storeTssKey)
  async __storeTssKey(data = {}) {
    console.log('TssPlugin.__storeTssKey', data)
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
    this.informJoinedToGroup();
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
