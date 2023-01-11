import {MultiPartyComputation} from "./base";

export interface IMpcNetwork {
  id: string,
  askRoundData: (from: string, mpcId: string, round: number, data?:any) => Promise<PartnerRoundReceive>,
  registerMcp: (mpc: MultiPartyComputation) => void
}

export interface MPCConstructData {
  id: string,
  partners: string[],
  rounds: string[],
  [x: string | number | symbol]: unknown;
}

export type MapOf<T> = {
  [index: string]: T
}

export type PartnerRoundReceive = {
  send: any,
  broadcast: any,
  qualifieds?: string[]
}

export type RoundOutput<ResultT, BroadcastT> = {
  /**
   * Pi may store any kind of data
   */
  store: MapOf<any>,
  /**
   * Pi return to each participant an specific ResultT
   */
  send: null | MapOf <ResultT>,
  /**
   * Pi broadcast a BroadcastT to all other participants
   */
  broadcast: null | BroadcastT,
  /**
   * non-responding and malignant partners excluded from mail list
   */
  qualifieds?: string[]
}

export type PartyConnectivityGraph = {[index: string]: string[]}

/**
 * Pi receives two type of data from previous step
 *
 * 1) output of all other participants
 * 2) broadcast from all participants
 */
export type RoundProcessor<ResultT, BroadcastT> =
  (prevStepOutput: MapOf<ResultT>, prevStepBroadcast: MapOf<BroadcastT>) => RoundOutput<ResultT, BroadcastT>
