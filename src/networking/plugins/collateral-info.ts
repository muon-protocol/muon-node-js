import BaseNetworkPlugin from './base/base-network-plugin'
import { OnlinePeerInfo } from '../types';
import TimeoutPromise from '../../common/timeout-promise'

export type GroupInfo = {
  isValid: boolean,
  group: string,
  sharedKey: string | null,
  partners: string[]
}

export type NetworkInfo = {
  tssThreshold: number,
  minGroupSize: number,
  maxGroupSize: number
}

export default class CollateralInfoPlugin extends BaseNetworkPlugin{

  groupInfo: GroupInfo | null = null;
  networkInfo: NetworkInfo | null = null;
  peersWallet: {[index: string]: string} = {}
  walletsPeer: {[index: string]: string} = {}
  onlinePeers: {[index: string]: OnlinePeerInfo} = {}
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "collateral loading timed out")

  async onStart(){
    super.onStart();
    this._loadCollateralInfo();

    this.network.on('peer:discovery', this.onPeerDiscovery.bind(this));
    this.network.on('peer:connect', this.onPeerConnect.bind(this));
    this.network.on('peer:disconnect', this.onPeerDisconnect.bind(this));

    // this.network.once('peer:connect', () => {
    //   console.log('first node connected ...')
    //   // Listen to contract events and inform any changes.
    //   // TODO: uncomment this. (commented for debug)
    //   // this._watchContractEvents();
    //
    //   this._loadCollateralInfo();
    // })
  }

  async onPeerDiscovery(peerId) {
    // console.log("peer available", peerId)
    this.onlinePeers[peerId._idB58String] = {
      wallet: this.getPeerWallet(peerId._idB58String),
      peerId,
      peer: await this.findPeer(peerId),
    }
  }

  async onPeerConnect(peerId) {
    // console.log("peer connected", peerId)
    this.onlinePeers[peerId._idB58String] = {
      wallet: this.getPeerWallet(peerId._idB58String),
      peerId,
      peer: await this.findPeer(peerId),
    }
  }

  onPeerDisconnect(disconnectedPeer) {
    // console.log("peer not available", peerId)
    delete this.onlinePeers[disconnectedPeer._idB58String];
  }

  async _loadCollateralInfo(){
    let {tss, collateralWallets} = this.network.configs.net;

    this.networkInfo = {
      tssThreshold: parseInt(tss.threshold),
      minGroupSize: parseInt(tss.min || tss.threshold),
      maxGroupSize: parseInt(tss.max)
    }

    let parts = collateralWallets.map(cw => cw.split('@'))
    if(parts.findIndex(p => p.length !== 2) >= 0) {
      throw "Invalid collateral wallet config located at config/global/net.conf.json"
    }

    this.groupInfo = {
      isValid: true,
      group: "1",
      sharedKey: null,
      partners: parts.map(item => item[0])
    }
    parts.forEach(([wallet, peerId]) => {
      this.peersWallet[peerId] = wallet
      this.walletsPeer[wallet] = peerId
    })

    if(process.env.VERBOSE) {
      console.log('CollateralInfo._loadCollateralInfo: Info loaded.');
    }

    this.emit('loaded');
    this.loading.resolve(true);
  }

  // TODO: not implemented
  getWallets(){
    return Object.keys(this.walletsPeer);
  }

  getPeerWallet(peerId) {
    if(typeof peerId === "string")
      return this.peersWallet[peerId];
    else
      return this.peersWallet[peerId.toB58String()];
  }

  getWalletPeerId(wallet) {
    return this.walletsPeer[wallet];
  }

  get GroupId(){
    return this.groupInfo?.group;
  }

  get TssThreshold(): number{
    if(!!this.networkInfo)
      return this.networkInfo?.tssThreshold
    else
      return Infinity;
  }

  hasEnoughPartners() {
    /**
     * onlinePartners not include current node
     */
    return Object.keys(this.onlinePeers).length + 1 >= this.TssThreshold
  }

  get MinGroupSize(){
    return this.networkInfo?.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo?.maxGroupSize;
  }

  waitToLoad(){
    return this.loading.promise;
  }

  isLoaded(): boolean{
    return this.loading.isFulfilled;
  }
}
