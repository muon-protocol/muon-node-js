import LevelPromise from "./level-promise";
import {Constructor} from "../types";

const Events = require('events-async')

const random = () => Math.floor(Math.random()*9999999)

export interface IRoundBased {
  send(to: string, data: any);
}

export interface MpcNetwork {
  id: string,
  send: (partner: string, round: number, data?:any) => Promise<any>,
  receive: () => {}
  on: (event, handler) => void
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

export class MultiPartyComputation {
  public readonly id: string;
  public readonly partners: string[]
  public readonly rounds: string[]
  protected store: MapOf<any> = {};
  private roundsPromise: LevelPromise;
  /** roundsArrivedMessages[roundId][from] = <ResultT> */
  private roundsArrivedMessages: MapOf<MapOf<any>> = {}

  constructor(id, partners: string[], rounds: string[]) {

    rounds.forEach(round => {
      if(!this[round])
        throw `round handler [${round}] not defined`
    })

    this.id = id || `DKG${Date.now()}${random()}`

    this.partners = partners
    this.rounds = rounds
    this.roundsPromise = new LevelPromise(rounds.length);

    rounds.forEach((roundTitle, roundIndex) => {
      this.roundsArrivedMessages[roundIndex] = {}
    })
  }

  registerMessageReceiveHandler(network: MpcNetwork) {
    network.on('message', this.onMessageArrive.bind(this))
  }

  async onMessageArrive(round: number, data: {from: string, send: any, broadcast: any}, networkId: string) {
    try {
      const strRound = this.rounds[round];
      // console.log(`${this.ConstructorName}[${networkId}][${strRound}] message arrive`, data)

      if (round > 0) {
        await this.roundsPromise.waitToLevelResolve(round - 1);
      }
      // console.log(`${this.ConstructorName}[${networkId}][${strRound}] processing ...`)
      const from = data.from;
      this.roundsArrivedMessages[round][from] = data;

      if (Object.keys(this.roundsArrivedMessages[round]).length === this.partners.length) {
        // console.log(`${this.ConstructorName}[${networkId}] ${strRound} completed`);
        this.roundsPromise.resolve(round, true);
      }
      return 'OK'
    }
    catch (e) {
      console.log(e)
      throw e
    }
  }

  async process(network: MpcNetwork) {
    // console.log(`================= ID:${network.id} start =================`)
    this.registerMessageReceiveHandler(network);

    try {

      for (let r = 0; r < this.rounds.length; r++) {
        const round = this.rounds[r]

        // console.log(`${this.ConstructorName}[${network.id}][${round}] start.`)
        /** prepare round handler inputs */
        let inputs: MapOf<any> = {}, broadcasts: MapOf<any> = {}
        if(r > 0) {
          const prevRoundReceives = this.roundsArrivedMessages[r-1];
          inputs = Object.keys(prevRoundReceives).map(from => {
            return prevRoundReceives[from].send
          })
          broadcasts = Object.keys(prevRoundReceives).reduce((obj, from) => {
            obj[from] = prevRoundReceives[from].broadcast
            return obj
          }, {})
        }
        /** execute MPC round */
        const {store, send, broadcast} = await this.processRound(r, inputs, broadcasts);
        this.store[r] = store

        // console.log(`${mpc.ConstructorName}[${network.id}][${round}] output.`, {store, send, broadcast})
        /** distribute round outputs */
        let allPartiesResult = await Promise.all(this.partners.map(partner => {
          const dataToSend = {from: network.id, send: send![partner], broadcast}
          return network.send(partner, r, dataToSend)
            .catch(e => {
              console.log(">>>>>", e)
              return "error"
            })
        }))
        // console.log(`${this.ConstructorName}[${network.id}][${round}] ends.`, {allPartiesResult})
        // mpc.addToStore(round, store)

        /** wait until the round is completed. */
        await this.roundsPromise.waitToLevelResolve(r);
      }

      // console.log(`${this.ConstructorName}[${network.id}] all rounds done.`)
      return this.finalize(this.roundsArrivedMessages, network.id);
    }catch (e) {
      // console.log(`ID:${network.id}`, e);
      throw e;
    }
  }

  finalize(roundsArrivedMessages, networkId): string { return "" }

  async processRound(roundIndex: number, input: MapOf<any>, broadcast: MapOf<any>): Promise<RoundOutput<any, any>> {
    const roundMethodName = this.rounds[roundIndex]
    return this[roundMethodName](input, broadcast)
  }

  addToStore(round: string, data: any) {
    this.store[round] = data;
  }

  get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }
}
