import Party from './party.js'
import BN from 'bn.js';
import { PublicKey } from './types'
import {DistKey} from "../../common/mpc/dist-key.js";

const random = () => Math.floor(Math.random()*9999999)

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

  private distKey: DistKey|undefined;

  private partnersPubKey = {}

  constructor(party, id, distKey?: DistKey){
    this.id = id || `K${Date.now()}${random()}`
    if(!!party) {
      this.party = party;
    }
    this.distKey = distKey
  }

  get address(): string {
    return this.distKey!.address;
  }

  get share(): BN {
    return this.distKey!.share
  }

  get publicKey(): PublicKey {
    return this.distKey!.publicKey
  }

  get partners(): string[] {
    return this.distKey!.partners;
  }

  toSerializable() {
    return {
      id: this.id,
      party: this.party?.id,
      share: !this.share ? null : this.share.toBuffer('be', 32).toString('hex'),
      publicKey: !this.publicKey ? null : this.publicKey.encode('hex', true),
      partners: [...this.partners],
    }
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
}
