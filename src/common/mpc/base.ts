import LevelPromise from "./level-promise.js";
import {MapOf, IMpcNetwork, RoundOutput, PartnerRoundReceive, PartyConnectivityGraph} from "./types";
import lodash from 'lodash'
import {timeout} from "../../utils/helpers.js";
import { logger, Logger } from '@libp2p/logger';
import _ from 'lodash';

const {countBy} = lodash;
const random = () => Math.floor(Math.random()*9999999)
const clone = (obj) => JSON.parse(JSON.stringify(obj))


export type MPCOpts = {
  id: string,
  rounds: string[],
  starter: string,
  partners: string[],
}

export class MultiPartyComputation {
  protected constructData;
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

  constructor(options: MPCOpts) {
    const {id, rounds, starter, partners} = options
    this.constructData = _.omit(options, ["rounds"]);

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

      const {send, broadcast, qualifieds} = this.roundsOutput[strRound] || {}

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

  private async tryToGetRoundDate(network: IMpcNetwork, from: string, roundIndex: number, dataToSend: any, responseNeeded: boolean) {
    const NumReTry = 1;
    const roundTitle = this.rounds[roundIndex];
    let lastError: any;
    let result: any;
    for(let i=1 ; i<=NumReTry ; i++) {
      lastError = undefined;
      try {
        if(responseNeeded) {
          result = await network.askRoundData(from, this.id, roundIndex, dataToSend);
          return result;
        }
        else {
          network.askRoundData(from, this.id, roundIndex, dataToSend).catch(e => {});
          return null;
        }
        break;
      }catch (e) {
        lastError = e;
        if(i != NumReTry)
          await timeout(i*1000)
      }
    }
    if(lastError)
      throw lastError;

    if(this.RoundValidations[roundTitle] && !this.RoundValidations[roundTitle](result)){
      // console.dir({r,currentRound, result}, {depth: null})
      this.log.error(`round[${roundTitle}] data validation error. data: %o`, result)
      // @ts-ignore
      throw this.RoundValidations[roundTitle].errors.map(e => e.message).join("\n");
    }
    return result;
  }

  getInitialQualifieds(): string[] {
    return clone(this.partners);
  }

  private async process(network: IMpcNetwork, timeout: number) {
    this.log = logger(`muon:common:mpc:${this.ConstructorName}`);
    const mpcExecDebugs = {}
    try {
      /** Some partners may be excluded during the MPC process. */
      let qualifiedPartners = this.getInitialQualifieds();
      this.log(`${this.ConstructorName}[${this.id}] start with partners %o`, qualifiedPartners)

      mpcExecDebugs['start'] = {qualifiedPartners};

      for (let r = 0; r < this.rounds.length; r++) {
        Object.freeze(qualifiedPartners);
        const roundStartTime = Date.now();

        const currentRound = this.rounds[r], previousRound = r>0 ? this.rounds[r-1] : null;
        this.log(`processing round mpc[${this.id}].${currentRound} ...`)

        mpcExecDebugs[currentRound] = {roundErrors: {}}

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
        const isQualified: MapOf<boolean> = this.partners.reduce((obj, id) => (obj[id]=qualifiedPartners.includes(id), obj), {})
        /** execute MPC round */
        if(isQualified[network.id]) {
          this.roundsOutput[currentRound] = await this.processRound(r, inputs, broadcasts, network.id, qualifiedPartners);
          mpcExecDebugs[currentRound].malicious = this.roundsOutput[currentRound].malicious;
          this.log(`round executed [${network.id}].mpc[${this.id}].${currentRound}`)
        }
        this.roundsPromise.resolve(r, true);

        /** Gather other partners data */
        const dataToSend = {
          constructData: r===0 ? this.constructData : undefined,
        }
        this.log(`MPC[${this.id}].${currentRound} collecting round data`)

        // TODO: its just for debuging
        // need to be removed
        let partyErrors = {};

        const callingPartners = r===0 ? this.partners : qualifiedPartners;

        let allPartiesResult: (PartnerRoundReceive|null)[] = await Promise.all(
          callingPartners.map(partner => {
            return this.tryToGetRoundDate(network, partner, r, dataToSend, isQualified[partner])
              .catch(e => {
                mpcExecDebugs[currentRound].roundErrors[partner] = e.message || "unknown error";
                partyErrors[partner] = JSON.stringify(e);
                this.log.error(`[${this.id}][${currentRound}] error at node[${partner}] round ${r} %o`, e)
                return null
              })
          })
        )
        this.log(`MPC[${this.id}].${currentRound} ${allPartiesResult.filter(i => !!i).length} nodes response received`)
        /** store partners output for current round */
        this.roundsArrivedMessages[currentRound] = allPartiesResult.reduce((obj, curr, i) => {
          if(isQualified[callingPartners[i]] && curr !== null)
            obj[callingPartners[i]] = curr;
          return obj
        }, {})

        /** update qualified list based on current round outputs */
        qualifiedPartners = this.extractQualifiedList(this.roundsArrivedMessages[currentRound!], qualifiedPartners);
        mpcExecDebugs[currentRound].qualifieds = qualifiedPartners;
        this.log(
          `MPC[${this.id}][${currentRound}] complete in %d ms with qualified list: %o`,
          Date.now() - roundStartTime,
          qualifiedPartners
        );

        if(qualifiedPartners.length < this.t) {
          throw {
            message: `${this.ConstructorName} needs ${this.t} partners but only [${qualifiedPartners.join(',')}] are qualified. partners=[${this.partners.join(',')}], round=${currentRound}, partyErrors=${JSON.stringify(partyErrors)}`,
            mpcExecDebugs,
          }
        }
      }

      this.log(`MPC[${this.id}] all rounds done.`)
      const result = this.onComplete(this.roundsArrivedMessages, network.id, qualifiedPartners);
      this.roundsPromise.resolve(this.rounds.length, result);
    }
    catch (e) {
      this.roundsPromise.reject(e);
      this.log.error('error when processing MPC', e)
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
