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
  polynomial?: {
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
  polynomial?: {
    t: number,
    Fx: PublicKey[]
  };

  constructor(index: string, share: BN, address: string, publicKey : PublicKey, partners: string[], polynomial?: {t: number, Fx: PublicKey[]}) {
    this.index = index;
    this.share = share;
    this.address = address;
    this.publicKey = publicKey;
    this.partners = partners,
      this.polynomial = polynomial;
  }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from the public key of shamir polynomial coefficients.
   * @param idx {string | BN} - index of participant
   * @returns PublicKey
   */
  getPublicKey(idx: number | string): PublicKey | null{
    if(!this.polynomial)
      return null;
    return TssModule.calcPolyPoint(idx, this.polynomial.Fx)
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
      polynomial: !this.polynomial ? undefined : {
        t: this.polynomial.t,
        Fx: this.polynomial.Fx.map(p => p.encode('hex', true))
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
      !key.polynomial ? undefined : {
        t: key.polynomial.t,
        Fx: key.polynomial.Fx.map(p => TssModule.keyFromPublic(p))
      },
    );
  }
}
