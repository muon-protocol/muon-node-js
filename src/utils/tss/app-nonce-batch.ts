import BN from 'bn.js';
import {Party, PartyInfo} from "../../common/types";
import { FrostCommitment, FrostNonce, NonceBatch, NonceBatchJson } from '../../common/mpc/dist-nonce.js';
import { MapOf } from '../../common/mpc/types';

const random = () => Math.floor(Math.random()*9999999)

export type AppNonceBatchJson = {
  id: string,
  party: PartyInfo,
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
  party: Party;

  private nonceBatch: NonceBatch;

  constructor(party: Party, id, nonceBatch: NonceBatch){
    this.id = id || `N${Date.now()}${random()}`
    this.party = party;
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
      party: {appId: this.party.appId, seed: this.party.seed},
      nonceBatch: this.nonceBatch.toJson(),
    }
  }

  static fromJson(party: Party, appNonceBatch: Omit<AppNonceBatchJson, "party">): AppNonceBatch {
    return new AppNonceBatch(
      party,
      appNonceBatch.id,
      NonceBatch.fromJson(appNonceBatch.nonceBatch)
    )
  }
}