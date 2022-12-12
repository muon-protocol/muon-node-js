const Events = require('events-async')

const random = () => Math.floor(Math.random()*9999999)

export interface IRoundBased {
  send(to: string, data: any);
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

export class MultiPartyComputation extends Events {
  public readonly id: string;
  public readonly partners: string[]
  public readonly rounds: string[]

  constructor(id, partners: string[], rounds: string[]) {
    super()

    rounds.forEach(round => {
      if(!this[round])
        throw `round handler [${round}] not defined`
    })

    this.id = id || `DKG${Date.now()}${random()}`

    this.partners = partners
    this.rounds = rounds
  }
}
