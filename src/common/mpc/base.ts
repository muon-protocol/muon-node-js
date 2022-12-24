import LevelPromise from "./level-promise";
import {MapOf, IMpcNetwork, RoundOutput, MPCConstructData} from "./types";

const random = () => Math.floor(Math.random()*9999999)

export class MultiPartyComputation {
  private readonly constructData;
  public readonly id: string;
  public readonly partners: string[]
  public readonly rounds: string[]
  protected store: MapOf<any> = {};
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

  async onMessageArrive(round: number, data: {from: string, send: any, broadcast: any}, networkId: string) {
    try {
      const strRound = this.rounds[round];
      // console.log(`${this.ConstructorName}[${networkId}][${strRound}] message arrive from ${data.from}`)

      if (round > 0) {
        await this.roundsPromise.waitToLevelResolve(round - 1);
      }
      // console.log(`${this.ConstructorName}[${networkId}][${strRound}] processing ...`)
      const from = data.from;
      this.roundsArrivedMessages[strRound][from] = data;

      if (Object.keys(this.roundsArrivedMessages[strRound]).length === this.partners.length) {
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

  async runByNetwork(network: IMpcNetwork, timeout: number=30000): Promise<any> {
    await network.registerMcp(this);
    /** n for rounds, 1 fore result */
    this.roundsPromise = new LevelPromise(this.rounds.length+1, timeout);
    this.process(network, timeout);
    return await this.roundsPromise.waitToFulFill()
  }

  private async process(network: IMpcNetwork, timeout: number) {
    try {
      for (let r = 0; r < this.rounds.length; r++) {
        const currentRound = this.rounds[r], previousRound = r>0 ? this.rounds[r-1] : null;
        // console.log(`processing round mpc[${this.id}].${this.rounds[r]} ...`)
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
        const {store, send, broadcast} = await this.processRound(r, inputs, broadcasts);
        this.store[currentRound] = store

        /** distribute round outputs */
        let allPartiesResult = await Promise.all(this.partners.map(partner => {
          let dataToSend = {
            from: network.id,
            send: send![partner],
            broadcast,
            constructData: r===0 ? this.constructData : undefined,
          }
          return network.send(partner, this.id, r, dataToSend)
            .catch(e => {
              // console.log(`${this.ConstructorName}[network.send] error at level ${r}`, e)
              return "error"
            })
        }))
        // console.log(`${this.ConstructorName}[${network.id}][${round}] ends.`, {allPartiesResult})

        /** wait until the round is completed. */
        await this.roundsPromise.waitToLevelResolve(r);
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

  async processRound(roundIndex: number, input: MapOf<any>, broadcast: MapOf<any>): Promise<RoundOutput<any, any>> {
    const roundMethodName = this.rounds[roundIndex]
    return this[roundMethodName](input, broadcast)
  }

  protected get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  waitToFulfill(){
    return this.roundsPromise.waitToFulFill();
  }
}
