import TimeoutPromise from '../../../common/timeout-promise'
import {returnStatement} from "@babel/types";
import {MuonNodeInfo} from "../../../common/types";
const {stackTrace} = require('../../../utils/helpers')

export default class TssParty {
  t: number = 0
  max: number = 0;
  id: string;
  /** map node wallet to OnlinePeerInfo */
  partners: {[index: string]: MuonNodeInfo} = {}
  timeoutPromise: TimeoutPromise;

  constructor(t, max, id=null, timeout=0){
    if(!process.env.SIGN_WALLET_ADDRESS || !process.env.PEER_ID)
      throw {message: "process.env.SIGN_WALLET_ADDRESS is not defined"}
    this.t = t;
    this.max = max;
    this.id = id || TssParty.newId()
    this.timeoutPromise = new TimeoutPromise(timeout, "Party join timeout", {resolveOnTimeout: true})
  }

  static newId(){
    return `P${Date.now()}${Math.floor(Math.random()*9999999)}`
  }

  static load(_party){
    let party = new TssParty(_party.t, _party.max, _party.id)
    party.partners = {};
    _party.partners.forEach(p => party.addPartner(p))
    party.timeoutPromise.resolve(party);
    return party;
  }

  /**
   * @param partner
   *
   */
  addPartner(partner: MuonNodeInfo){
    if(typeof partner === 'string')
      throw "partner most be object of type {wallet,peerId}"
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

  setWalletPeer(wallet, peer){
    if(typeof peer !== 'string') {
      console.log(`WARNING: peer should be string.`)
      stackTrace()
    }
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

  size(){
    return Object.keys(this.partners).length
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }

  get onlinePartners(): {[index: string]: MuonNodeInfo}{
    let {partners} = this
    return Object.values(partners)
      .filter(p => (!!p.peer || p.wallet===process.env.SIGN_WALLET_ADDRESS))
      .reduce((obj, p) => {
        obj[p.wallet] = p
        return obj;
      }, {})
  }
}
