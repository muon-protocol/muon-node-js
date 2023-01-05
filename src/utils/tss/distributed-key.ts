import Polynomial from './polynomial.js'
import Party from './party.js'
import BN from 'bn.js';
import { PublicKey } from './types'
import * as tss from './index.js'
import * as nobel from '@noble/secp256k1'
import Web3 from 'web3'
import TimeoutPromise from '../../common/timeout-promise.js'
import assert from 'assert'
import {bigint2hex, buf2str} from "./utils.js";

const {utils:{toBN}} = Web3
const random = () => Math.floor(Math.random()*9999999)

export type KeyPart = {
  f: bigint,
  h: bigint,
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
  pubKeyParts: {[index: string]: PublicKey[]} = {};
  commitmentParts = {};
  keyDistributed = false;
  step1FullfillPromise: TimeoutPromise;
  timeoutPromise: TimeoutPromise;

  share: bigint | null = null;
  sharePubKey: string;
  publicKey: PublicKey | null = null
  partnersPubKey = {}
  address: string

  constructor(party, id, timeout?: number, value?: bigint){
    this.id = id || `K${Date.now()}${random()}`
    if(!!party) {
      this.party = party;

      let fx = new Polynomial(party.t, tss.curve, value);
      let hx = new Polynomial(party.t, tss.curve);
      this.f_x = fx
      this.h_x = hx
      // pedersen commitment
      let fxCoefPubKeys = fx.coefPubKeys();
      let hxCoefPubKeys = hx.coefPubKeys(tss.H)
      this.commitment = fxCoefPubKeys.map((A, index) => tss.pointAdd(A, hxCoefPubKeys[index]));
    }
    this.timeoutPromise = new TimeoutPromise(timeout, "DistributedKey timeout")
  }

  static loadPubKey(publicKey): PublicKey {
    if(typeof publicKey === "string")
      return tss.keyFromPublic(publicKey.replace("0x", ""))
    else if(Array.isArray(publicKey))
      return tss.keyFromPublic({x: publicKey[0], y: publicKey[1]})
    else
      return publicKey
  }

  static load(party, _key){
    let key = new DistributedKey(party, _key.id);
    key.id = _key.id;
    key.f_x = null;
    key.h_x = null;
    key.share = BigInt(_key.share);
    key.sharePubKey = buf2str(nobel.getPublicKey(tss.keyFromPrivate(_key.share)));
    key.publicKey = this.loadPubKey(_key.publicKey)
    key.address = tss.pub2addr(key.publicKey)
    if(_key.partners)
      key.partners = _key.partners;
    if(_key.pubKeyParts && Object.keys(_key.pubKeyParts).length > 0){
      Object.keys(_key.pubKeyParts).forEach(index => {
        key.pubKeyParts[index] = _key.pubKeyParts[index].map(w => tss.keyFromPublic(w))
      })
    }
    key.timeoutPromise.resolve(key);
    return key
  }

  toSerializable() {
    return {
      id: this.id,
      party: this.party?.id,
      share: !this.share ? null : bigint2hex(this.share),
      publicKey: !this.publicKey ? null : this.publicKey.toHex(true),
      partners: [...this.partners],
      pubKeyParts: Object.keys(this.pubKeyParts).reduce((res, partner) => {
        res[partner] = this.pubKeyParts[partner].map(pubKey => pubKey.toHex(true))
        return res;
      }, {}),
    }
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

  // setPartnerShare(currentNodeIndex, fromIndex, keyPartners, f, h, publicKeys, commitment) {
  //   /**
  //    * Check pedersen commitment
  //    */
  //   let p1: PublicKey = tss.calcPolyPoint(currentNodeIndex, commitment)
  //   let p2: PublicKey = tss.pointAdd(tss.curve.g.multiply(f), tss.H.multiply(h));
  //   if(!p1.equals(p2)) {
  //     throw `DistributedKey partial data verification failed from partner ${fromIndex}.`
  //   }
  //   this.commitmentParts[fromIndex] = commitment;
  //
  //   this.partners = keyPartners;
  //   this.keyParts[fromIndex] = {f:BigInt(f), h: BigInt(h)}
  //   this.pubKeyParts[fromIndex] = publicKeys
  //
  //   this.checkKeyFinalization()
  // }

  // setSelfShare(selfIndex, f, h, publicKeys) {
  //   this.keyParts[selfIndex] = {f:BigInt(f), h: BigInt(h)}
  //   this.pubKeyParts[selfIndex] = publicKeys
  //
  //   this.checkKeyFinalization()
  // }

  // checkKeyFinalization() {
  //   if(this.isKeyDistributed()){
  //     let fh = this.getTotalFH()
  //     this.share = fh.f;
  //     this.sharePubKey = buf2str(nobel.getPublicKey(fh.f));
  //     this.publicKey = this.getTotalPubKey();
  //     this.address = tss.pub2addr(this.publicKey)
  //     this.timeoutPromise.resolve(this)
  //   }
  // }

  // getTotalFH(){
  //   // calculate shared key
  //   let f = 0n
  //   let h = 0n
  //   for(const [i, {f: _f, h: _h}] of Object.entries(this.keyParts)){
  //     f = f + BigInt(_f)
  //     h = h + BigInt(_h)
  //   }
  //   return {f:nobel.utils.mod(f, tss.curve.n), h: nobel.utils.mod(h, tss.curve.n)}
  // }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from public key of local shared polynomials coefficients.
   * @param idx
   * @returns {[string, any]}
   */
  getPubKey(idx){
    // if(!this.partnersPubKey[idx]) {
    //   this.partnersPubKey[idx] = Object.entries(this.pubKeyParts)
    //   // .filter(([i, A_ik]) => parseInt(i) !== idx)
    //     .reduce((acc, [i, A_ik]) => {
    //       return tss.pointAdd(acc, tss.calcPolyPoint(idx, A_ik))
    //     }, null)
    // }
    // return this.partnersPubKey[idx]
  }

  getTotalPubKey(): PublicKey{
    assert(
      // TODO: replace with this.partners.length
      this.party && Object.keys(this.pubKeyParts).length >= this.party.t,
      `DistributedKey is not completed for computing totalPubKey. {t: ${this?.party?.t}, n: ${Object.keys(this.pubKeyParts).length}}`
    )
    // calculate shared key
    let totalPubKey: PublicKey|null = null
    for(const [i, A_ik] of Object.entries(this.pubKeyParts)){
      totalPubKey = tss.pointAdd(totalPubKey, A_ik[0])
    }
    return totalPubKey!
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
