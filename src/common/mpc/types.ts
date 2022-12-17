import {MultiPartyComputation} from "./base";

export interface MpcNetwork {
  id: string,
  send: (partner: string, mpcId: string, round: number, data?:any) => Promise<any>,
  receive: () => {}
  registerMcp: (mpc: MultiPartyComputation) => void
}

export interface MPCConstructData {
  id: string,
  partners: string[],
  otherParams?: any[]
}

export type MapOf<T> = {
  [index: string]: T
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
  broadcast: null | BroadcastT
}

/**
 * Pi receives two type of data from previous step
 *
 * 1) output of all other participants
 * 2) broadcast from all participants
 */
export type RoundProcessor<ResultT, BroadcastT> =
  (prevStepOutput: MapOf<ResultT>, prevStepBroadcast: MapOf<BroadcastT>) => RoundOutput<ResultT, BroadcastT>
