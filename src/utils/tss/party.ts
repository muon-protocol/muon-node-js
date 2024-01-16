import TimeoutPromise from '../../common/timeout-promise.js'

type PartyLoadParams = {
  id?: string,
  t: number,
  max: number,
  partners: string[]
}

export default class TssParty {
  t: number = 0
  max: number = 0;
  id: string;
  /** map nodeId to MuonNodeInfo */
  partners: string[]
  timeoutPromise: TimeoutPromise;

  constructor(t: number, max: number, id?:string, timeout?:number){
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

  static load(_party: PartyLoadParams){
    let party = new TssParty(_party.t, _party.max, _party.id)
    party.partners = _party.partners;
    _party.partners.forEach(p => party.addPartner(p))
    party.timeoutPromise.resolve(party);
    return party;
  }

  /**
   * @param partner
   *
   */
  addPartner(partner: string){
    if(typeof partner !== 'string')
      throw "partner most be string"
    if(!this.partners.includes(partner))
    {
      this.partners.push(partner)
      if(this.isFulfilled()) {
        this.timeoutPromise.resolve(this)
      }
    }
  }

  deletePartner(id: string) {
    delete this.partners[id]
  }

  hasEnoughPartners(){
    let {partners, t} = this;
    return Object.keys(partners).length >= t;
  }

  isFulfilled(){
    let {partners, t, max} = this;
    return partners.length >= max;
  }

  size(){
    return this.partners.length
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }
}
