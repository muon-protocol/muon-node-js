import BN from "bn.js";
import {PublicKey} from "../../utils/tss/types";
import * as TssModule from "../../utils/tss/index.js";
import {bn2str} from "./utils.js";
import {toBN} from "../../utils/helpers.js";
import { MapOf } from "./types";


export type FrostCommitment = {D: PublicKey, E: PublicKey}

export type FrostCommitmentJson = {D: string, E: string}

export type FrostNonce = {
  d: BN, 
  e: BN,
  commitments: MapOf<FrostCommitment>
}

export type FrostNonceJson = {
  d: string, 
  e: string,
  commitments: MapOf<FrostCommitmentJson>
}

export type NonceBatchJson = {
  n: number,
  partners: string[],
  nonces: FrostNonceJson[],
}

export class NonceBatch {
  n: number;
  partners: string[];
  nonces: FrostNonce[];

  constructor(n: number, partners: string[], nonces: FrostNonce[]) {
    this.n = n;
    this.partners = partners;
    this.nonces = nonces;
  }

  toJson(): NonceBatchJson {
    return {
      n: this.n,
      partners: this.partners,
      nonces: this.nonces.map(({d, e, commitments}) => ({
        d: bn2str(d), 
        e: bn2str(e),
        commitments: Object.entries(commitments).reduce((obj, [id, {D, E}]) => {
          obj[id] = {
            D: D.encode("hex", true),
            E: E.encode("hex", true),
          }
          return obj;
        }, {})
      }))
    }
  }

  static fromJson(data: NonceBatchJson): NonceBatch {
    return new NonceBatch(
      data.n,
      data.partners,
      data.nonces.map(({d, e, commitments}) => ({
        d: toBN(d), 
        e: toBN(e),
        commitments: Object.entries(commitments).reduce((obj, [id, {D, E}]) => {
          obj[id] = {
            D: TssModule.keyFromPublic(D),
            E: TssModule.keyFromPublic(E),
          }
          return obj;
        }, {})
      }))
    );
  }
}
