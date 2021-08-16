const Polynomial = require('../../utils/tss/polynomial')
const Point = require('../../utils/tss/point')
const tss = require('../../utils/tss/index')
const {toBN, range} = require('../../utils/tss/utils')
const assert = require('assert')

const random = () => Math.floor(Math.random()*9999999)

function WrappedPromise() {
  var self = this;
  this.promise = new Promise(function(resolve, reject) {
    self.reject = reject
    self.resolve = resolve
  })
}

class DistributedKey {
  id = 0;
  party = null;
  f_x = null
  h_x = null;
  // pedersen commitment
  commitment = null

  keyParts = {};
  pubKeyParts = {};
  commitmentParts = {};
  pubKeyDistributed = false;
  sharedKey = new WrappedPromise()

  constructor(party, id){
    this.id = id || `K${Date.now()}${random()}`
    this.party = party;
    this.f_x = new Polynomial(party.t, tss.curve);
    this.h_x = new Polynomial(party.t, tss.curve);
    // pedersen commitment
    this.commitment = this.f_x.coefficients.map((a, i) => {
      let A = tss.scalarMult(a, tss.curve.g)
      let H = tss.scalarMult(this.h_x.coefficients[i], tss.H)
      return tss.pointAdd(A, H)
    })
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
    this.commitmentParts[fromIndex] = commitment.map(c => Point.deserialize(c))
  }

  setParticipantPubKeys(fromIndex, A_ik){
    this.pubKeyParts[fromIndex] = A_ik.map(A => Point.deserialize(A))
    if(this.isPubKeyDistributed()){
      let fh = this.getTotalFH()
      this.sharedKey.resolve(fh)
    }
  }

  verifyCommitment(index){
    let Cc = this.commitmentParts[index]
    let p1 = tss.calcPolyPoint(index, Cc)
    let {f, h} = this.keyParts[index]
    const mul = tss.scalarMult, G=tss.curve.g, H=tss.H;
    let p2 = tss.pointAdd(mul(f, G), mul(h,H));
    console.log('DistributedKey.verifyCommitment', {
      p1: p1.serialize(),
      p2: p2.serialize(),
    })
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
   * public key calculated from public key of shared polynomials coefficients.
   * @param idx
   * @returns {[string, any]}
   */
  getPubKey(idx){
    return Object.entries(this.pubKeyParts)
      // .filter(([i, A_ik]) => parseInt(i) !== idx)
      .reduce((acc, [i, A_ik]) => {
        return tss.pointAdd(acc, tss.calcPolyPoint(idx, A_ik))
      }, null)
  }

  getTotalPubKey(){
    assert(Object.keys(this.pubKeyParts).length >= this.party.t)
    // calculate shared key
    let totalPubKey = null
    for(const [i, A_ik] of Object.entries(this.pubKeyParts)){
      totalPubKey = tss.pointAdd(totalPubKey, A_ik[0])
    }
    return totalPubKey
  }

  isKeyDistributed(){
    let {keyParts, party: {t, partners}} = this
    // All nodes (except current node) must share their part of shared key.
    return Object.keys(keyParts).length >= Object.keys(partners).length-1;
  }

  isPubKeyDistributed(){
    let {pubKeyParts, party: {t, partners}} = this
    // All nodes must share their part of shared key.
    return Object.keys(pubKeyParts).length >= Object.keys(partners).length;
  }

  getSharedKey(){
    return this.sharedKey.promise;
  }
}

module.exports = DistributedKey;
