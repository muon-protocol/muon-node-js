import Polynomial from '../../../utils/tss/polynomial'
import Party from './party'
import BN from 'bn.js';
import { PublicKey } from '../../../utils/tss/types'
const tss = require('../../../utils/tss/index')
const {utils:{toBN}} = require('web3')
import TimeoutPromise from '../../../common/timeout-promise'
const assert = require('assert')

const random = () => Math.floor(Math.random()*9999999)

export type KeyPart = {
    f: BN,
    h: BN,
}

class DistributedKey {
  /**
   * id of key
   * @type {string}
   */
  id: string = "0";
  /**
   * party that this key created from.
   */
  party: Party | null = null;
  /**
   * partners of party, that cooperate to create this key
   */
  partners: string[] = [];

  f_x: Polynomial | null = null

  h_x: Polynomial | null = null;

  // pedersen commitment
  commitment: PublicKey[] = []

  /**
   * Key share from other key partners
   * @type {{
   *   [STAKE_WALLET_ADDRESS]: {f: f(i), h: h(i)},
   *   ...
   * }}
   */
  keyParts: {[index: string]: KeyPart} = {};
  /**
   * PublicKey of F_x of each partners
   * @type {{
   *  [STAKE_WALLET_ADDRESS]: [ PublicKey ],
   *  ...
   * }}
   */
  pubKeyParts: {[index: string]: PublicKey} = {};
  commitmentParts = {};
  keyDistributed = false;
  timeoutPromise: TimeoutPromise;

  share = null;
  sharePubKey = null;
  publicKey = null
  partnersPubKey = {}
  address = null

  constructor(party, id, timeout?: number){
    this.id = id || `K${Date.now()}${random()}`
    if(!!party) {
      this.party = party;

      let fx = new Polynomial(party.t, tss.curve);
      let hx = new Polynomial(party.t, tss.curve);
      this.f_x = fx
      this.h_x = hx
      // pedersen commitment
      let fxCoefPubKeys = fx.coefPubKeys();
      let hxCoefPubKeys = hx.coefficients.map(c => c.getPrivate()).map(b_k => tss.H.mul(b_k))
      this.commitment = fxCoefPubKeys.map((A, index) => tss.pointAdd(A, hxCoefPubKeys[index]));
    }
    this.timeoutPromise = new TimeoutPromise(timeout, "DistributedKey timeout")
  }

  static load(party, _key){
    let key = new DistributedKey(party, _key.id);
    key.id = _key.id;
    key.f_x = null;
    key.h_x = null;
    key.share = toBN(_key.share);
    key.sharePubKey = tss.keyFromPrivate(_key.share).getPublic().encode('hex');
    key.publicKey = _key.publicKey
    if(_key.partners)
      key.partners = _key.partners;
    if(_key.pubKeyParts && Object.keys(_key.pubKeyParts).length > 0){
      Object.keys(_key.pubKeyParts).forEach(w => {
        key.pubKeyParts[w] = _key.pubKeyParts[w].map(w => tss.keyFromPublic(w))
      })
    }
    key.timeoutPromise.resolve(key);
    return key
  }

  getFH(toIndex){
    if(!this.f_x)
      throw {message: "DistributedKey.f_x is not initialized"}
    if(!this.h_x)
      throw {message: "DistributedKey.h_x is not initialized"}
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
    if(!process.env.SIGN_WALLET_ADDRESS)
      throw {message: "process.env.SIGN_WALLET_ADDRESS is undefined"}
    const from = process.env.SIGN_WALLET_ADDRESS;
    this.keyParts[from] = {f:toBN(f), h: toBN(h)}
    this.pubKeyParts[from] = publicKeys

    this.checkKeyFinalization()
  }

  checkKeyFinalization() {
    if(this.isKeyDistributed()){
      let fh = this.getTotalFH()
      this.share = fh.f;
      this.sharePubKey = tss.keyFromPrivate(fh.f).getPublic().encode('hex')
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
      this.party && Object.keys(this.pubKeyParts).length >= this.party.t,
      `DistributedKey is not completed for computing totalPubKey. {t: ${this?.party?.t}, n: ${Object.keys(this.pubKeyParts).length}}`
    )
    // calculate shared key
    let totalPubKey = null
    for(const [i, A_ik] of Object.entries(this.pubKeyParts)){
      totalPubKey = tss.pointAdd(totalPubKey, A_ik[0])
    }
    return totalPubKey
  }

  isKeyDistributed(){
    let {pubKeyParts} = this
    return Object.keys(pubKeyParts).length === this.partners.length;
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }
}

export default DistributedKey;
