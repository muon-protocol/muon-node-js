import LevelPromise from "./level-promise.js";
import Ajv from 'ajv';
import {MapOf, IMpcNetwork, RoundOutput, MPCConstructData, PartnerRoundReceive} from "./types";
import lodash from 'lodash'

const {countBy} = lodash;

const random = () => Math.floor(Math.random()*9999999)
const ajv = new Ajv()
// for(let round of this.rounds) {
//   if(this.InputSchema[round])
//     ajv.addSchema(this.InputSchema[round], round);
// }

export class MultiPartyComputation {
  private readonly constructData;
  protected t: number;
  public readonly id: string;
  public readonly partners: string[]
  public readonly rounds: string[]
  private roundsOutput: MapOf<RoundOutput<any, any>> = {};
  private roundsPromise: LevelPromise;
  /** roundsArrivedMessages[roundId][from] = <ResultT> */
  private roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>> = {}
  protected InputSchema: object;

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

  private makeUnique(lists: string[][], threshold) {
    // @ts-ignore
    let arr = [].concat(...lists);
    const counts = countBy(arr);
    return Object.keys(counts).filter(item => counts[item] >= threshold);
  }

  protected extractQualifiedList(roundReceivedMsgs, defaultQualified) {
    const availablePartnersList = Object.keys(roundReceivedMsgs)
      .filter(sender => !!roundReceivedMsgs[sender])
      .map(from => {
        return roundReceivedMsgs[from]?.broadcast?.qualifieds || defaultQualified
      })
    const qualifieds = this.makeUnique(availablePartnersList, this.t)
      .filter(sender => !!roundReceivedMsgs[sender])
    return qualifieds
  }

  async getPartnerRoundData(round: number, partner: string): Promise<PartnerRoundReceive> {
    try {
      const strRound = this.rounds[round];

      /** wait for the round to be executed and data to be prepared. */
      await this.roundsPromise.waitToLevelResolve(round);

      const {send, broadcast} = this.roundsOutput[strRound]

      return {
        send: !!send ? send[partner] : undefined,
        broadcast,
      };
    }
    catch (e) {
      console.log(e)
      throw e
    }
  }

  async runByNetwork(network: IMpcNetwork, timeout: number=10000): Promise<any> {
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

  protected getRoundReceives(round: string) {
    return this.roundsArrivedMessages[round];
  }

  protected getStore(round: string) {
    return this.roundsOutput[round].store;
  }

  private async process(network: IMpcNetwork, timeout: number) {
    try {
      /** Some partners may be excluded during the MPC process. */
      let qualifiedPartners = this.partners;

      for (let r = 0; r < this.rounds.length; r++) {
        const currentRound = this.rounds[r], previousRound = r>0 ? this.rounds[r-1] : null;
        // console.log(`processing round mpc[${this.id}].${currentRound} ...`)
        /** prepare round handler inputs */
        let inputs: MapOf<any> = {}, broadcasts: MapOf<any> = {}
        if(r > 0) {
          const prevRoundReceives = this.roundsArrivedMessages[previousRound!];
          inputs = qualifiedPartners.map(from => {
            return prevRoundReceives[from].send
          })
          broadcasts = qualifiedPartners.reduce((obj, from) => {
            obj[from] = prevRoundReceives[from].broadcast
            return obj
          }, {})
        }
        /** execute MPC round */
        this.roundsOutput[currentRound] = await this.processRound(r, inputs, broadcasts, network.id, qualifiedPartners);
        // console.log(`round executed [${network.id}].mpc[${this.id}].${currentRound} ...`, {currentRound, store, send, broadcast})
        this.roundsPromise.resolve(r, true);

        /** Gather other partners data */
        const dataToSend = {
          constructData: r===0 ? this.constructData : undefined,
        }
        let allPartiesResult: (PartnerRoundReceive|null)[] = await Promise.all(
          qualifiedPartners.map(partner => {
            return network.askRoundData(partner, this.id, r, dataToSend)
              .then(result => {
                if(this.InputSchema[currentRound] && !ajv.validate(this.InputSchema[currentRound], result)){
                  // console.dir({r,currentRound, result}, {depth: null})
                  // @ts-ignore
                  throw ajv.errors.map(e => e.message).join("\n");
                }
                return result;
              })
              .catch(e => {
                console.log(`${this.ConstructorName}[network.askRoundData] error at level ${r}`, e)
                return null
              })
          })
        )
        this.roundsArrivedMessages[currentRound] = allPartiesResult.reduce((obj, curr, i) => {
          if(curr !== null)
            obj[qualifiedPartners[i]] = curr;
          return obj
        }, {})

        qualifiedPartners = this.extractQualifiedList(this.roundsArrivedMessages[currentRound], qualifiedPartners);
      }

      // console.log(`${this.ConstructorName}[${network.id}] all rounds done.`)
      const result = this.onComplete(this.roundsArrivedMessages, network.id, qualifiedPartners);
      this.roundsPromise.resolve(this.rounds.length, result);
    }
    catch (e) {
      this.roundsPromise.reject(e);
      // console.log('error when processing MPC', e)
    }
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId: string, partners: string[]): any { return "" }

  async processRound(roundIndex: number, input: MapOf<any>, broadcast: MapOf<any>, networkId: string, partners: string[]):
    Promise<RoundOutput<any, any>> {
    const roundMethodName = this.rounds[roundIndex]
    return await this[roundMethodName](input, broadcast, networkId, partners)
  }

  protected get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  waitToFulfill(){
    return this.roundsPromise.waitToFulFill();
  }
}
