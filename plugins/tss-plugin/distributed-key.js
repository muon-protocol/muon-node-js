const Polynomial = require('../../utils/tss/polynomial')
const Point = require('../../utils/tss/point')
const {curve, pointAdd, calcPolyPoint, shareKey} = require('../../utils/tss/index')
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

  keyParts = {};
  pubKeyParts = {};
  pubKeyDistributed = false;
  sharedKey = new WrappedPromise()

  constructor(party, id){
    this.id = id || `K${Date.now()}${random()}`
    this.party = party;
    this.f_x = new Polynomial(party.t, curve);
    this.h_x = new Polynomial(party.t, curve);
  }

  setFH(fromIndex, f, h){
    this.keyParts[fromIndex] = {f, h}
  }

  getFH(toIndex){
    return {
      f: this.f_x.calc(toIndex),
      h: this.h_x.calc(toIndex),
    }
  }

  setParticipantPubKeys(fromIndex, A_ik){
    this.pubKeyParts[fromIndex] = A_ik.map(A => Point.deserialize(A))
    if(this.isPubKeyDistributed()){
      let fh = this.getTotalFH()
      this.sharedKey.resolve(fh)
    }
  }

  getTotalFH(){
    // calculate shared key
    let f = toBN(0)
    let h = toBN(0)
    for(const [i, {f: _f, h: _h}] of Object.entries(this.keyParts)){
      f.iadd(toBN(_f))
      h.iadd(toBN(_h))
    }
    return {f:f.umod(curve.n), h: h.umod(curve.n)}
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
        return pointAdd(acc, calcPolyPoint(idx, A_ik))
      }, null)
  }

  getTotalPubKey(){
    assert(Object.keys(this.pubKeyParts).length >= this.party.t)
    // calculate shared key
    let totalPubKey = null
    for(const [i, A_ik] of Object.entries(this.pubKeyParts)){
      totalPubKey = pointAdd(totalPubKey, A_ik[0])
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
