const Events = require('events-async')

export interface IRoundBased {
  send(to: string, data: any);
}

export type RoundResultIn<T> = {
  [index: string]: T
}

export type RoundBroadcastIn<T> = {
  [index: string]: T
}

export type RoundResultOut<T> = {
  [index: string]: T
}

export type RoundBroudcastOut<T> = T

export type RoundOutput<ResultT, BroadcastT> = {
  output: {[index: string]: any},
  broadcast: any
}

export type RoundProcessor<T1, T2> =
  (prevStepOutput: RoundResultIn<T1>, prevStepBroadcast: RoundBroadcastIn<T2>)
    =>
    RoundOutput<T1, T2>

export class MultiPartyComputation extends Events {
  private partners: string[]
  private steps: string[]

  constructor(partners: string[], steps: string[]) {
    super()

    this.partners = partners
    this.steps = steps
  }
}
