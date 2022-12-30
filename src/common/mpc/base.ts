import LevelPromise from "./level-promise.js";
import {MapOf, IMpcNetwork, RoundOutput, MPCConstructData, PartnerRoundReceive} from "./types";

const random = () => Math.floor(Math.random()*9999999)

export class MultiPartyComputation {
  private readonly constructData;
  public readonly id: string;
  public readonly partners: string[]
  public readonly rounds: string[]
  protected store: MapOf<any> = {};
  private send: MapOf<any> = {};
  private broadcast: MapOf<any> = {};
  private roundsPromise: LevelPromise;
  /** roundsArrivedMessages[roundId][from] = <ResultT> */
  protected roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>> = {}

  constructor(rounds: string[], id: string, partners: string[]) {
    this.constructData = Object.values(arguments).slice(1)

    rounds.forEach(round => {
      if(!this[round])
        throw `round handler [${round}] not defined`
    })

    this.id = id || `${Date.now()}${random()}`

    this.partners = partners
    this.rounds = rounds

    rounds.forEach(roundTitle => {
      this.roundsArrivedMessages[roundTitle] = {}
    })
  }

  async getPartnerRoundData(round: number, partner: string): Promise<PartnerRoundReceive> {
    try {
      const strRound = this.rounds[round];

      /** wait for the round to be executed and data to be prepared. */
      await this.roundsPromise.waitToLevelResolve(round);

      return {
        send: this.send[strRound][partner],
        broadcast: this.broadcast[strRound],
      };
    }
    catch (e) {
      console.log(e)
      throw e
    }
  }

  async runByNetwork(network: IMpcNetwork, timeout: number=30000): Promise<any> {
    /** n for rounds, 1 fore result */
    this.roundsPromise = new LevelPromise(this.rounds.length+1, timeout);
    /** assign MPC task to this process */
    try {
      await network.registerMcp(this);
    }catch (e) {
      this.roundsPromise.reject(e);
    }
    /** process the mpc */
    this.process(network, timeout);
    /** return the mpc task promise */
    return await this.roundsPromise.waitToFulFill()
  }

  private async process(network: IMpcNetwork, timeout: number) {
    try {
      for (let r = 0; r < this.rounds.length; r++) {
        const currentRound = this.rounds[r], previousRound = r>0 ? this.rounds[r-1] : null;
        // console.log(`processing round mpc[${this.id}].${currentRound} ...`)
        /** prepare round handler inputs */
        let inputs: MapOf<any> = {}, broadcasts: MapOf<any> = {}
        if(r > 0) {
          const prevRoundReceives = this.roundsArrivedMessages[previousRound!];
          inputs = Object.keys(prevRoundReceives).map(from => {
            return prevRoundReceives[from].send
          })
          broadcasts = Object.keys(prevRoundReceives).reduce((obj, from) => {
            obj[from] = prevRoundReceives[from].broadcast
            return obj
          }, {})
        }
        /** execute MPC round */
        const {store, send, broadcast} = await this.processRound(r, inputs, broadcasts, network.id);
        this.store[currentRound] = store
        this.send[currentRound] = send
        this.broadcast[currentRound] = broadcast
        // console.log(`round executed [${network.id}].mpc[${this.id}].${currentRound} ...`, {currentRound, store, send, broadcast})
        this.roundsPromise.resolve(r, true);

        /** Gather other partners data */
        const dataToSend = {
          constructData: r===0 ? this.constructData : undefined,
        }
        let allPartiesResult: (PartnerRoundReceive|null)[] = await Promise.all(this.partners.map(partner => {
          return network.askRoundData(partner, this.id, r, dataToSend)
            .catch(e => {
              console.log(`${this.ConstructorName}[network.askRoundData] error at level ${r}`, e)
              return null
            })
        }))
        this.roundsArrivedMessages[currentRound] = allPartiesResult.reduce((obj, curr, i) => {
          if(curr !== null)
            obj[this.partners[i]] = curr;
          return obj
        }, {})
      }

      // console.log(`${this.ConstructorName}[${network.id}] all rounds done.`)
      const result = this.onComplete(this.roundsArrivedMessages, network.id);
      this.roundsPromise.resolve(this.rounds.length, result);
    }
    catch (e) {
      this.roundsPromise.reject(e);
      // console.log('error when processing MPC', e)
    }
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId): any { return "" }

  async processRound(roundIndex: number, input: MapOf<any>, broadcast: MapOf<any>, networkId: string): Promise<RoundOutput<any, any>> {
    const roundMethodName = this.rounds[roundIndex]
    return this[roundMethodName](input, broadcast, networkId)
  }

  protected get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  waitToFulfill(){
    return this.roundsPromise.waitToFulFill();
  }
}
