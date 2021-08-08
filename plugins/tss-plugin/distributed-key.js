const Polynomial = require('../../utils/tss/polynomial')
const {curve, lagrangeCoef} = require('../../utils/tss/index')
const {toBN} = require('../../utils/tss/utils')

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
    let knownKey = toBN(process.env.SIGN_WALLET_PRIVATE_KEY)

    this.id = id || `K${Date.now()}${random()}`
    this.party = party;
    this.f_x = new Polynomial(party.t, curve, knownKey);
    this.h_x = new Polynomial(party.t, curve, knownKey);
  }

  setFH(fromIndex, f, h){
    this.keyParts[fromIndex] = {f, h}
    // if(this.isKeyDistributed()){
    //   let fh = this.getTotalFH()
    //   this.sharedKey.resolve(fh)
    // }

  }

  getFH(toIndex){
    return {
      f: this.f_x.calc(toIndex),
      h: this.h_x.calc(toIndex),
    }
  }

  setPubKeyPortion(fromIndex, A0){
    this.pubKeyParts[fromIndex] = A0
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
      // console.log(`f from parties[${i}]: ${_f}`)
      // console.log(`h from parties[${i}]: ${_h}`)
      f.iadd(toBN(_f))
      h.iadd(toBN(_h))
    }
    // console.log(`==== count ${Object.keys(this.keyParts).length} ====`)
    // console.log(`total f: ${f.toString(16)}`)
    // console.log(`total h: ${h.toString(16)}`)
    return {f, h}
  }

  getTotalPubKey(){
    // calculate shared key
    let x = toBN(0)
    let y = toBN(0)
    let list = Object.keys(this.pubKeyParts).map(i => ({i: parseInt(i)}))
    for(const [i, {x: _x, y: _y}] of Object.entries(this.pubKeyParts)){
      // TODO
      // let w = toBN(lagrangeCoef(parseInt(i), this.party.t, list))
      // x.iadd(w.mul(toBN(_x)))
      // y.iadd(w.mul(toBN(_y)))
    }
    return {x, y}
  }

  isKeyDistributed(){
    let {keyParts, party: {t, partners}} = this
    // All nodes (except current node) must share their part of shared key.
    return Object.keys(keyParts).length >= Object.keys(partners).length-1;
  }

  isPubKeyDistributed(){
    let {pubKeyParts, party: {t, partners}} = this
    // All nodes (except current node) must share their part of shared key.
    return Object.keys(pubKeyParts).length >= Object.keys(partners).length-1;
  }

  getSharedKey(){
    return this.sharedKey.promise;
  }
}

module.exports = DistributedKey;
