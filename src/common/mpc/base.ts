import LevelPromise from "./level-promise.js";
import Ajv from 'ajv';
import {MapOf, IMpcNetwork, RoundOutput, MPCConstructData, PartnerRoundReceive, PartyConnectivityGraph} from "./types";
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
  public readonly starter: string
  public readonly partners: string[]
  public readonly rounds: string[]
  private roundsOutput: MapOf<RoundOutput<any, any>> = {};
  private roundsPromise: LevelPromise;
  /** roundsArrivedMessages[roundId][from] = <ResultT> */
  private roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>> = {}
  protected InputSchema: object;

  constructor(rounds: string[], id: string, starter: string, partners: string[]) {
    this.constructData = Object.values(arguments).slice(1)

    rounds.forEach(round => {
      if(!this[round])
        throw `round handler [${round}] not defined`
    })

    this.id = id || `${Date.now()}${random()}`

    this.starter = starter;
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

  private removeGraphNode(graph: PartyConnectivityGraph, removingNode: string) {
    delete graph[removingNode]
    Object.keys(graph).forEach(node => {
      let index = graph[node].indexOf(removingNode)
      if(index >= 0)
        graph[node].splice(index, 1);
    })
  }

  private isGraphFullyConnected(graph: PartyConnectivityGraph): boolean {
    const nodes = Object.keys(graph)
    // @ts-ignore
    let connectionsCount = countBy([].concat(...Object.values(graph)))

    /** there is a node without connection */
    if(nodes.length != Object.keys(connectionsCount).length)
      return true;

    /** each node is connected with it self too */
    let numConnections = nodes.length;
    for(let node of nodes) {
      if(connectionsCount[node] != numConnections)
        return false;
    }

    return true;
  }

  private findFullyConnectedSubGraph(inputGraph: PartyConnectivityGraph): PartyConnectivityGraph {
    let graph: PartyConnectivityGraph;

    /** clone input graph */
    try {
      graph = JSON.parse(JSON.stringify(inputGraph))
    }catch (e) {
      return {}
    }

    /** remove Unidirectional edges */
    Object.keys(graph).forEach(node => {
      graph[node] = graph[node].filter(connection => graph[connection]?.includes(node))
    })

    /**
     * sort nodes order by connections|ID
     * nodes with larger amounts of connections or lower ID have more priority to be selected.
     */
    // @ts-ignore
    const arr = [].concat(...Object.values(graph));
    const connectionCounts = countBy(arr);
    let sortedNodes = Object.entries(connectionCounts)
      .sort((a, b) => {
        return a[1] > b[1] || parseInt(a[0]) < parseInt(b[0]) ? 1 : -1
      })
      .map(entry => entry[0])

    /** remove low priority nodes one by one, in order to graph be fully connected. */
    for(let i=0 ; i<sortedNodes.length && !this.isGraphFullyConnected(graph) ; i++) {
      this.removeGraphNode(graph, sortedNodes[i]);
    }
    return graph;
  }

  private extractQualifiedList(roundReceivedMsgs, defaultQualified) {
    /** make graph of connection between nodes */
    let connectionGraph = Object.keys(roundReceivedMsgs).reduce(
      (obj, id) => {
        obj[id] = roundReceivedMsgs[id].qualifieds || defaultQualified
        return obj
      }, {});

    /** remove nodes that not connected with starter node */
    Object.keys(connectionGraph).forEach(node => {
      if(!connectionGraph[this.starter].includes(node)) {
        delete connectionGraph[node];
      }
    })

    /** find an optimal fully connected sub-graph */
    const fullyConnectedSubGraph = this.findFullyConnectedSubGraph(connectionGraph);

    /** return nodes of fully connected sub-graph */
    return Object.keys(fullyConnectedSubGraph);
  }

  async getPartnerRoundData(round: number, partner: string): Promise<PartnerRoundReceive> {
    try {
      const strRound = this.rounds[round];

      /** wait for the round to be executed and data to be prepared. */
      await this.roundsPromise.waitToLevelResolve(round);

      const {send, broadcast, qualifieds} = this.roundsOutput[strRound]

      return {
        send: !!send ? send[partner] : undefined,
        broadcast,
        qualifieds,
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
          /** update qualified list based on previous round outputs */
          qualifiedPartners = this.extractQualifiedList(this.roundsArrivedMessages[previousRound!], qualifiedPartners);

          /** prepare current round input based on previous round output */
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
        console.log(`MPC.processRound[${currentRound}] with qualified list: `, qualifiedPartners);
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
        /** store partners output for current round */
        this.roundsArrivedMessages[currentRound] = allPartiesResult.reduce((obj, curr, i) => {
          if(curr !== null)
            obj[qualifiedPartners[i]] = curr;
          return obj
        }, {})
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
