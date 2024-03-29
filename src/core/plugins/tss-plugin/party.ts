import TimeoutPromise from '../../../common/timeout-promise'
import { OnlinePeerInfo } from "../../../networking/types";

export default class TssParty {
  t: number = 0
  max: number = 0;
  id: string;
  partners: {[index: string]: OnlinePeerInfo} = {}
  timeoutPromise: TimeoutPromise;

  constructor(t, max, id=null, timeout=0){
    if(!process.env.SIGN_WALLET_ADDRESS || !process.env.PEER_ID)
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    this.t = t;
    this.max = max;
    this.id = id || `P${Date.now()}${Math.floor(Math.random()*9999999)}`
    this.partners[process.env.SIGN_WALLET_ADDRESS] = {
      peerId: process.env.PEER_ID,
      wallet: process.env.SIGN_WALLET_ADDRESS,
    }
    this.timeoutPromise = new TimeoutPromise(timeout, "Party join timeout", {resolveOnTimeout: true})
  }

  static load(_party){
    let party = new TssParty(_party.t, _party.max, _party.id)
    party.partners = {};
    _party.partners.map(p => party.addPartner(p))
    party.timeoutPromise.resolve(party);
    return party;
  }

  /**
   * @param partner
   *
   */
  addPartner(partner){
    if(typeof partner === 'string')
      throw {message: "partner most be object of type {wallet,peerId}"}
    // if(this.partners[partner.wallet] === undefined)
    {
      this.partners[partner.wallet] = {
        // if partner has "i" property, it replace default "i".
        ...partner
      }
      if(this.isFulfilled()) {
        this.timeoutPromise.resolve(this)
      }
    }
  }

  setPeers(peers){
    try {
      let id2wallet = {};
      for (let wallet in this.partners) {
        let {peerId} = this.partners[wallet]
        id2wallet[peerId] = wallet
      }
      peers.filter(p => !!p).map(peer => {
        if (peer.id === undefined)
          console.log({peer})
        let key = peer.id.toB58String()
        let wallet = id2wallet[key]
        this.partners[wallet].peer = peer
      })
    }
    catch (e) {
      console.error("Party.setPeers", e);
      throw e;
    }
  }

  setWalletPeer(wallet, peer){
    if(this.partners[wallet] !== undefined) {
      this.partners[wallet].peer = peer
    }
  }

  hasEnoughPartners(){
    let {partners, t} = this;
    return Object.keys(partners).length >= t;
  }

  isFulfilled(){
    let {partners, t, max} = this;
    return Object.keys(partners).length >= max;
  }

  getPeers(){
    let peersWallet = Object.keys(this.partners).filter(wallet => wallet !== process.env.SIGN_WALLET_ADDRESS)
    return peersWallet.map(w => this.partners[w].peer).filter(p => !!p)
  }

  size(){
    return Object.keys(this.partners).length
  }

  makePoly(){
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }

  get onlinePartners(): {[index: string]: OnlinePeerInfo}{
    let {partners} = this
    return Object.values(partners)
      .filter(p => (!!p.peer || p.wallet===process.env.SIGN_WALLET_ADDRESS))
      .reduce((obj, p) => {
        obj[p.wallet] = p
        return obj;
      }, {})
  }
}
