import BN from "bn.js";
import {PublicKey} from "../../utils/tss/types";
import * as TssModule from "../../utils/tss/index.js";
import {bn2str} from "./utils.js";
import {toBN} from "../../utils/helpers.js";
import { MapOf } from "./types";


export type DistNonce = {d: BN, e: BN}

export type DistNonceJson = {d: string, e: string}

export type DistNonceCommitment = {D: PublicKey, E: PublicKey}

export type DistNonceCommitmentJson = {D: string, E: string}

export type NonceBatchJson = {
  pi: number,
  partners: string[],
  nonces: DistNonceJson[],
  commitments: MapOf<DistNonceCommitmentJson[]>,
}

export class NonceBatch {
  pi: number;
  partners: string[];
  nonces: DistNonce[];
  commitments: MapOf<DistNonceCommitment[]>;

  constructor(pi: number, partners: string[], nonces: DistNonce[], commitments: MapOf<DistNonceCommitment[]>) {
    this.pi = pi;
    this.partners = partners;
    this.nonces = nonces;
    this.commitments = commitments;
  }

  // getNonce(index: number): DistNonce | undefined{
  //   return TssModule.calcPolyPoint(idx, this.polynomial.Fx)
  // }

  toJson(): NonceBatchJson {
    return {
      pi: this.pi,
      partners: this.partners,
      nonces: this.nonces.map(({d, e}) => ({d: bn2str(d), e: bn2str(e)})),
      commitments: Object.entries(this.commitments).reduce((obj, [id, commitments]) => {
        obj[id] = commitments.map(({D, E}) => ({
          D: D.encode("hex", true),
          E: E.encode("hex", true),
        }))
        return obj;
      }, {}),
    }
  }

  // static fromJson(key: DistKeyJson): DistKey {
  //   const publicKey = TssModule.keyFromPublic(key.publicKey)
  //   const address = TssModule.pub2addr(publicKey)
  //   if(address.toLowerCase() !== key.address.toLowerCase())
  //     throw `DistKeyJson address mismatched with publicKey`
  //   return new DistKey(
  //     key.index,
  //     toBN(key.share),
  //     address,
  //     publicKey,
  //     key.partners,
  //     !key.polynomial ? undefined : {
  //       t: key.polynomial.t,
  //       Fx: key.polynomial.Fx.map(p => TssModule.keyFromPublic(p))
  //     },
  //   );
  // }
}
