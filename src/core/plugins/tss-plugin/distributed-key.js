const Polynomial = require('../../../utils/tss/polynomial')
const tss = require('../../../utils/tss/index')
const {utils:{toBN}} = require('web3')
const TimeoutPromise = require('../../../core/timeout-promise')
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

  /**
   * Key share from other key partners
   * @type {{
   *   [STAKE_WALLET_ADDRESS]: {f: f(i), h: h(i)},
   *   ...
   * }}
   */
  keyParts = {};
  /**
   * PublicKey of F_x of each partners
   * @type {{
   *  [STAKE_WALLET_ADDRESS]: [ PublicKey ],
   *  ...
   * }}
   */
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
    let fxCoefPubKeys = this.f_x.coefPubKeys();
    let hxCoefPubKeys = this.h_x.coefficients.map(c => c.getPrivate()).map(b_k => tss.H.mul(b_k))
    this.commitment = fxCoefPubKeys.map((A, index) => tss.pointAdd(A, hxCoefPubKeys[index]));
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

  getFH(toIndex){
    return {
      f: this.f_x.calc(toIndex),
      h: this.h_x.calc(toIndex),
    }
  }

  setPartnerShare(from, keyPartners, f, h, publicKeys, commitment) {
    /**
     * Check pedersen commitment
     */
    let p1 = tss.calcPolyPoint(process.env.SIGN_WALLET_ADDRESS, commitment)
    let p2 = tss.pointAdd(tss.curve.g.mul(f), tss.H.mul(h));
    if(!p1.eq(p2)) {
      throw `DistributedKey partial data verification failed from partner ${from}.`
    }
    this.commitmentParts[from] = commitment;

    this.partners = keyPartners;
    this.keyParts[from] = {f:toBN(f), h: toBN(h)}
    this.pubKeyParts[from] = publicKeys

    this.checkKeyFinalization()
  }

  setSelfShare(f, h, publicKeys) {
    const from = process.env.SIGN_WALLET_ADDRESS;
    this.keyParts[from] = {f:toBN(f), h: toBN(h)}
    this.pubKeyParts[from] = publicKeys

    this.checkKeyFinalization()
  }

  checkKeyFinalization() {
    if(this.isKeyDistributed()){
      let fh = this.getTotalFH()
      this.share = fh.f;
      this.publicKey = this.getTotalPubKey();
      this.timeoutPromise.resolve(this)
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
