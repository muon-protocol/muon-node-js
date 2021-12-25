const Polynomial = require('../../utils/tss/polynomial')
const Point = require('../../utils/tss/point')
const tss = require('../../utils/tss/index')
const {toBN, range} = require('../../utils/tss/utils')
const TimeoutPromise = require('../../core/timeout-promise')
const assert = require('assert')

const random = () => Math.floor(Math.random()*9999999)

class DistributedKey {
  /**
   * id of key
   * @type {number}
   */
  id = 0;
  /**
   * party that this key created from.
   */
  party = null;
  /**
   * partners of party, that cooperate to create this key
   */
  partners = [];
  f_x = null
  h_x = null;
  // pedersen commitment
  commitment = []

  keyParts = {};
  pubKeyParts = {};
  commitmentParts = {};
  keyDistributed = false;
  timeoutPromise = null;

  share = null;
  publicKey = null
  partnersPubKey = {}
  address = null

  constructor(party, id, timeout){
    this.id = id || `K${Date.now()}${random()}`
    this.party = party;
    this.f_x = new Polynomial(party.t, tss.curve);
    this.h_x = new Polynomial(party.t, tss.curve);
    // pedersen commitment
    // this.commitment = this.f_x.coefficients.map((a, i) => {
    //   let A = tss.scalarMult(a, tss.curve.g)
    //   let H = tss.scalarMult(this.h_x.coefficients[i], tss.H)
    //   return tss.pointAdd(A, H)
    // })
    this.timeoutPromise = new TimeoutPromise(timeout, "DistributedKey timeout")
  }

  static load(party, _key){
    let key = new DistributedKey(party, _key.id);
    key.id = _key.id;
    key.f_x = null;
    key.h_x = null;
    key.share = _key.share;
    key.publicKey = _key.publicKey
    key.timeoutPromise.resolve(key);
    return key
  }

  setFH(fromIndex, f, h){
    this.keyParts[fromIndex] = {f:toBN(f), h: toBN(h)}
  }

  getFH(toIndex){
    return {
      f: this.f_x.calc(toIndex),
      h: this.h_x.calc(toIndex),
    }
  }

  setParticipantCommitment(fromIndex, commitment){
    // TODO: Pedersen commitment, not implemented
    // this.commitmentParts[fromIndex] = commitment.map(c => Point.deserialize(c))
  }

  setParticipantPubKeys(fromIndex, A_ik){
    this.pubKeyParts[fromIndex] = A_ik
    if(this.isPubKeyDistributed()){
      let fh = this.getTotalFH()
      this.share = fh.f;
      this.publicKey = this.getTotalPubKey();
      this.timeoutPromise.resolve(this)
    }
  }

  verifyCommitment(index){
    // TODO: not implemented
    // let Cc = this.commitmentParts[index]
    // let p1 = tss.calcPolyPoint(index, Cc)
    // let {f, h} = this.keyParts[index]
    // const mul = tss.scalarMult, G=tss.curve.g, H=tss.H;
    // let p2 = tss.pointAdd(mul(f, G), mul(h,H));
    // console.log('DistributedKey.verifyCommitment', {
    //   p1: p1.serialize(),
    //   p2: p2.serialize(),
    // })
  }

  getTotalFH(){
    // calculate shared key
    let f = toBN(0)
    let h = toBN(0)
    for(const [i, {f: _f, h: _h}] of Object.entries(this.keyParts)){
      f.iadd(toBN(_f))
      h.iadd(toBN(_h))
    }
    return {f:f.umod(tss.curve.n), h: h.umod(tss.curve.n)}
  }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from public key of local shared polynomials coefficients.
   * @param idx
   * @returns {[string, any]}
   */
  getPubKey(idx){
    if(!this.partnersPubKey[idx]) {
      this.partnersPubKey[idx] = Object.entries(this.pubKeyParts)
      // .filter(([i, A_ik]) => parseInt(i) !== idx)
        .reduce((acc, [i, A_ik]) => {
          return tss.pointAdd(acc, tss.calcPolyPoint(idx, A_ik))
        }, null)
    }
    return this.partnersPubKey[idx]
  }

  getTotalPubKey(){
    assert(
      // TODO: replace with this.partners.length
      Object.keys(this.pubKeyParts).length >= this.party.t,
      `DistributedKey is not completed for computing totalPubKey. {t: ${this.party.t}, n: ${Object.keys(this.pubKeyParts).length}}`
    )
    // calculate shared key
    let totalPubKey = null
    for(const [i, A_ik] of Object.entries(this.pubKeyParts)){
      totalPubKey = tss.pointAdd(totalPubKey, A_ik[0])
    }
    return totalPubKey
  }

  isKeyDistributed(){
    let {keyParts, party: {t, partners, onlinePartners}} = this
    // All nodes (except current node) must share their part of shared key.
    return Object.keys(keyParts).length >= Object.keys(onlinePartners).length-1;
  }

  isPubKeyDistributed(){
    let {pubKeyParts, party: {t, partners, onlinePartners}} = this
    // All nodes must share their part of shared key.
    // return Object.keys(pubKeyParts).length >= Object.keys(onlinePartners).length;
    return Object.keys(pubKeyParts).length === this.partners.length;
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }
}

module.exports = DistributedKey;
