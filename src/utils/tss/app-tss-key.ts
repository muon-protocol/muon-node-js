import Party from './party.js'
import BN from 'bn.js';
import { PublicKey } from './types'
import {DistKey} from "../../common/mpc/dist-key.js";
import * as tssModule from "./index.js";
import {bn2hex} from "./utils.js";

const random = () => Math.floor(Math.random()*9999999)

export type AppTssKeyJson = {
  id: string,
  party: string,
  share: string,
  publicKey: string,
  partners: string[],
  polynomial?: {
    t: number,
    Fx: string[]
  }
}

/**
 * A wrapper around MPC DistKey
 * Since MPC DistKey does not contain id and party information, this wrapper adds them.
 */
export default class AppTssKey {
  /**
   * id of key
   * @type {string}
   */
  id: string = "0";
  /**
   * party that this key created from.
   */
  party: Party | null = null;

  private distKey: DistKey;

  private partnersPubKey = {}

  constructor(party, id, distKey: DistKey){
    this.id = id || `K${Date.now()}${random()}`
    if(!!party) {
      this.party = party;
    }
    this.distKey = distKey
  }

  get address(): string {
    return this.distKey.address;
  }

  get share(): BN {
    return this.distKey.share
  }

  get publicKey(): PublicKey {
    return this.distKey.publicKey
  }

  get partners(): string[] {
    return this.distKey.partners;
  }

  toJson(): AppTssKeyJson {
    return {
      id: this.id,
      party: this.party!.id,
      share: bn2hex(this.share),
      publicKey: this.publicKey.encode('hex', true),
      partners: [...this.partners],
      polynomial: !this.distKey.polynomial ? undefined : {
        t: this.distKey.polynomial.t,
        Fx: this.distKey.polynomial.Fx.map(p => p.encode('hex', true))
      }
    }
  }

  static fromJson(party: Party, muonId:string, key: Omit<AppTssKeyJson, "party">): AppTssKey {
    return new AppTssKey(
      party,
      key.id,
      DistKey.fromJson({
        index: muonId,
        share: key.share,
        publicKey: key.publicKey,
        address: tssModule.pub2addr(tssModule.keyFromPublic(key.publicKey)),
        partners: key.partners,
        polynomial: key.polynomial,
      })
    )
  }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from public key of local shared polynomials coefficients.
   * @param idx
   * @returns {[string, any]}
   */
  getPubKey(idx){
    if(!this.partnersPubKey[idx]) {
      this.partnersPubKey[idx] = this.distKey!.getPublicKey(idx);
    }
    return this.partnersPubKey[idx]
  }

  /**
   Old version of keys was not storing polynomial info
   */
  hasPolynomialInfo() {
    return !!this.distKey.polynomial
  }
}
