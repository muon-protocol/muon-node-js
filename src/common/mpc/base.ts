import LevelPromise from "./level-promise.js";
import Ajv from 'ajv';
import {MapOf, IMpcNetwork, RoundOutput, MPCConstructData, PartnerRoundReceive, PartyConnectivityGraph} from "./types";
import lodash from 'lodash'
import * as PromiseLibs from '../promise-libs.js'
import {timeout} from "../../utils/helpers.js";
import { logger, Logger } from '@libp2p/logger'
import * as NetworkIpc from "../../network/ipc.js";

const {countBy} = lodash;
const random = () => Math.floor(Math.random()*9999999)
const clone = (obj) => JSON.parse(JSON.stringify(obj))
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
  protected RoundValidations: object;
  protected log: Logger;

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
      graph[node] = graph[node].filter(connection => {
        return Array.isArray(graph[connection]) && graph[connection].includes(node)
      })
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
    if(!Array.isArray(connectionGraph[this.starter]))
      connectionGraph = {}
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
      this.log && this.log.error("error when getting round data %O", e)
      throw e
    }
  }

  async runByNetwork(network: IMpcNetwork, timeout: number=35000): Promise<any> {
    /** n for rounds, 1 fore result */
    this.roundsPromise = new LevelPromise(this.rounds.length+1, timeout);
    /** assign MPC task to this process */
    try {
      await network.registerMpc(this);
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

  private async tryToGetRoundData(network: IMpcNetwork, from: string, roundIndex: number, dataToSend: any) {
    const roundTitle = this.rounds[roundIndex];
    let result: any = await network.askRoundData(from, this.id, roundIndex, dataToSend);
    if(this.RoundValidations[roundTitle] && !this.RoundValidations[roundTitle](result)){
      // console.dir({r,currentRound, result}, {depth: null})
      this.log.error(`round[${roundTitle}] data validation error. data: %o`, result)
      // @ts-ignore
      throw this.RoundValidations[roundTitle].errors.map(e => e.message).join("\n");
    }
    return result;
  }

  private async process(network: IMpcNetwork, timeout: number) {
    const currentNodeInfo = await NetworkIpc.getCurrentNodeInfo();
    let execData = {
      nodeId: currentNodeInfo!.id,
      init: Date.now()
    };
    this.log = logger(`muon:common:mpc:${this.ConstructorName}`);
    try {
      /** Some partners may be excluded during the MPC process. */
      let qualifiedPartners = clone(this.partners);
      this.log(`${this.ConstructorName}[${this.id}] start with partners %o`, qualifiedPartners)

      for (let r = 0; r < this.rounds.length; r++) {
        Object.freeze(qualifiedPartners);
        const roundStartTime = Date.now();
        execData["round " + r] = {
          computation: {start: Date.now()}
        };

        const currentRound = this.rounds[r], previousRound = r>0 ? this.rounds[r-1] : null;
        this.log(`processing round mpc[${this.id}].${currentRound} ...`)
        /** prepare round handler inputs */
        let inputs: MapOf<any> = {}, broadcasts: MapOf<any> = {}
        if(r > 0) {
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
        this.roundsOutput[currentRound] = await this.processRound(r, inputs, broadcasts, network.id, qualifiedPartners);
        this.log(`round executed [${network.id}].mpc[${this.id}].${currentRound}`)
        this.roundsPromise.resolve(r, true);
        execData["round " + r]["computation"]["end"] = Date.now();

        /** Gather other partners data */
        const dataToSend = {
          constructData: r===0 ? this.constructData : undefined,
        }
        this.log(`mpc[${this.id}].${currentRound} collecting round data`)
        let allPartiesResult: (PartnerRoundReceive|null)[] = await Promise.all(
            qualifiedPartners.map(partner => {
              const start = Date.now();
              return this.tryToGetRoundData(network, partner, r, dataToSend)
                .catch(e => {
                  this.log.error(`[${this.id}][${currentRound}] error at node[${partner}] round ${r} %o`, e)
                  return null
                })
                .finally(()=>{
                  execData["round " + r]["request node " + partner] = {
                    start: start,
                    end: Date.now()
                  }
                })
            })
          )
        this.log(`MPC[${this.id}].${currentRound} ${allPartiesResult.filter(i => !!i).length} nodes response received`)
        /** store partners output for current round */
        this.roundsArrivedMessages[currentRound] = allPartiesResult.reduce((obj, curr, i) => {
          if(curr !== null)
            obj[qualifiedPartners[i]] = curr;
          return obj
        }, {})

        /** update qualified list based on current round outputs */
        qualifiedPartners = this.extractQualifiedList(this.roundsArrivedMessages[currentRound!], qualifiedPartners);
        this.log(
          `MPC[${this.id}][${currentRound}] complete in %d ms with qualified list: %o`,
          Date.now() - roundStartTime,
          qualifiedPartners
        );

        if(qualifiedPartners.length < this.t) {
          throw `${this.ConstructorName} needs ${this.t} partners but only [${qualifiedPartners.join(',')}] are qualified`
        }
      }


      this.log(`MPC[${this.id}] all rounds done.`)
      const result = this.onComplete(this.roundsArrivedMessages, network.id, qualifiedPartners, execData);
      this.roundsPromise.resolve(this.rounds.length, result);
    }
    catch (e) {
      this.roundsPromise.reject(e);
      this.log.error('error when processing MPC', e)
    }
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{ send: any, broadcast: any }>>, networkId: string, partners: string[], execData: any): any {
    return ""
  }

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
