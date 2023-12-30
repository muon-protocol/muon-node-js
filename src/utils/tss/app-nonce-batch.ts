import BN from 'bn.js';
import {Party, PartyInfo} from "../../common/types";
import { FrostCommitment, FrostNonce, NonceBatch, NonceBatchJson } from '../../common/mpc/dist-nonce.js';
import { MapOf } from '../../common/mpc/types';

const random = () => Math.floor(Math.random()*9999999)

export type AppNonceBatchJson = {
  id: string,
  partyInfo: PartyInfo,
  nonceBatch: NonceBatchJson
}

/**
 * A wrapper around MPC NonceBatch
 * Since MPC NonceBatch does not contain id and party information, this wrapper adds them.
 */
export default class AppNonceBatch {
  /**
   * id of key
   * @type {string}
   */
  id: string = "0";
  /**
   * party that this key created from.
   */
  partyInfo: PartyInfo;

  private nonceBatch: NonceBatch;

  constructor(partyInfo: PartyInfo, id, nonceBatch: NonceBatch){
    this.id = id || `N${Date.now()}${random()}`
    this.partyInfo = partyInfo;
    this.nonceBatch = nonceBatch
  }

//   get address(): string {
//     return this.distKey.address;
//   }

  getNonce(index: number): FrostNonce {
    return this.nonceBatch.nonces[index];
  }

  get partners(): string[] {
    return this.nonceBatch.partners;
  }

  toJson(): AppNonceBatchJson {
    return {
      id: this.id,
      partyInfo: this.partyInfo,
      nonceBatch: this.nonceBatch.toJson(),
    }
  }

  static fromJson(appNonceBatch: AppNonceBatchJson): AppNonceBatch {
    return new AppNonceBatch(
      appNonceBatch.partyInfo,
      appNonceBatch.id,
      NonceBatch.fromJson(appNonceBatch.nonceBatch)
    )
  }
}