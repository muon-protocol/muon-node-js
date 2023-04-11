import BN from "bn.js";
import {PublicKey} from "../../utils/tss/types";
import Web3 from 'web3'
import * as TssModule from "../../utils/tss/index.js";
import {bn2str} from "./utils.js";

const {toBN} = Web3.utils

export type DistKeyJson = {
  index: string,
  share: string,
  address: string,
  publicKey: string,
  partners: string[],
  curve: {
    t: number,
    Fx: string[]
  }
}

export class DistKey {
  index: string;
  share: BN;
  address: string;
  publicKey: PublicKey;
  partners: string[];
  curve: {
    t: number,
    Fx: PublicKey[]
  };

  constructor(index: string, share: BN, address: string, publicKey : PublicKey, partners: string[], curve: {t: number, Fx: PublicKey[]}) {
    this.index = index;
    this.share = share;
    this.address = address;
    this.publicKey = publicKey;
    this.partners = partners,
      this.curve = curve;
  }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from the public key of shamir polynomial coefficients.
   * @param idx {string | BN} - index of participant
   * @returns PublicKey
   */
  getPublicKey(idx: number | string): PublicKey{
    return TssModule.calcPolyPoint(idx, this.curve.Fx)
  }

  publicKeyLargerThanHalfN() {
    return TssModule.HALF_N.lt(this.publicKey.getX())
  }

  toJson(): DistKeyJson {
    return {
      index: this.index,
      share: bn2str(this.share),
      address: this.address,
      publicKey: this.publicKey.encode('hex', true),
      partners: this.partners,
      curve: {
        t: this.curve.t,
        Fx: this.curve.Fx.map(p => p.encode('hex', true))
      }
    }
  }

  static fromJson(key: DistKeyJson): DistKey {
    const publicKey = TssModule.keyFromPublic(key.publicKey)
    const address = TssModule.pub2addr(publicKey)
    if(address.toLowerCase() !== key.address.toLowerCase())
      throw `DistKeyJson address mismatched with publicKey`
    return new DistKey(
      key.index,
      toBN(key.share),
      address,
      publicKey,
      key.partners,
      {
        t: key.curve.t,
        Fx: key.curve.Fx.map(p => TssModule.keyFromPublic(p))
      },
    );
  }
}
