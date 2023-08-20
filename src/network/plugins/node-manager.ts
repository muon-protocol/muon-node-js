import CallablePlugin from './base/callable-plugin.js'
import TimeoutPromise from '../../common/timeout-promise.js'
import * as eth from '../../utils/eth.js'
import {stackTrace, timeout} from '../../utils/helpers.js'
import {MuonNodeInfo, NodeManagerData} from "../../common/types";
import * as CoreIpc from '../../core/ipc.js'
import _ from 'lodash'
import {logger} from '@libp2p/logger'
import { createRequire } from "module";
import {
  getNodeManagerDataFromCache,
  storeNodeManagerDataIntoCache,
  tryAndGetNodeManagerChanges,
  tryAndGetNodeManagerData
} from "../utils.js";
import {remoteApp, remoteMethod} from "./base/app-decorators.js";
import lodash from "lodash";
import {Network} from "../index";
import {ifSynced} from "../remotecall-middleware.js";

const require = createRequire(import.meta.url);
const NodeManagerAbi = require('../../data/NodeManager-ABI.json')
const log = logger('muon:network:plugins:node-manager')


export type NodeFilterOptions = {
  list?: string[],
  isDeployer?: boolean,
  excludeSelf?: boolean
}

const RemoteMethods = {
  CheckOnline: 'CKON',
}

export type NodeManagerPluginConfigs = {
  initialNodeManagerData: NodeManagerData
}

@remoteApp
export default class NodeManagerPlugin extends CallablePlugin{

  private lastNodesUpdateTime: number;
  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();

  constructor(network: Network, configs: NodeManagerPluginConfigs) {
    super(network, configs);
  }

  async onInit() {
    await super.onInit()

    let {nodeManager} = this.network.configs.net;

    let {lastUpdateTime, nodes} = (this.configs as NodeManagerPluginConfigs).initialNodeManagerData;

    this.lastNodesUpdateTime = lastUpdateTime;
    this.watchNodesChange(nodeManager)

    this._nodesList = nodes;
    nodes.forEach(n => {
      this._nodesMap
        .set(n.id, n)
        .set(n.wallet, n)
        .set(n.peerId, n)
    })
  }

  async onStart() {
    await super.onStart()

    this.updateCache()
      .catch(e => {})
  }

  private updateNodeInfo(index: string, dataToMerge: object) {
    let nodeInfo = this.getNodeInfo(index)!;
    if(nodeInfo) {
      log(`updating node [${nodeInfo.id}]`, dataToMerge);
      /** update fields */
      // console.log('updating', nodeInfo)
      if(dataToMerge) {
        Object.keys(dataToMerge).forEach(key => {
          nodeInfo[key] = dataToMerge[key];
        })
      }
    }
    else {
      log(`node info not found for ${index} to update %o`, dataToMerge)
    }
  }

  /**
   * All events that changes the lastUpdateTime:
   *
   * 1) Add new node.
   * 2) Remove node by Admin
   * 3) Deactivate node by collateral address
   * 4) Edit isDeployer
   * 5) Edit node roles
   */
  async onNodesChange() {
    log(`nodes list updating ...`)
    let {nodeManager} = this.network.configs.net;

    let {lastUpdateTime, nodes: changes} = await tryAndGetNodeManagerChanges(nodeManager, this.lastNodesUpdateTime);
    this.lastNodesUpdateTime = lastUpdateTime;
    log(`NodeManager data changed: ${changes.length} nodes`)

    const addedNodes: any[] = []
    const deletedNodes = {}
    changes.forEach(n => {
      /** A violent node may use another node's peerId. */
      if(!!this._nodesMap[n.peerId] && n.id !== this._nodesMap[n.peerId]?.id) {
        console.log(`same peerId used by two nodes`, {
          peerId: n.peerId,
          nodes: [n.id, this._nodesMap[n.peerId]?.id]
        })
        return;
      }
      /**
       * 2) Remove node by Admin
       * 3) Deactivate node by collateral address
       */
      if(!n.active) {
        this._nodesMap.delete(n.id)
        this._nodesMap.delete(n.wallet)
        this._nodesMap.delete(n.peerId)
        log(`Node info deleted from chain %o`, n)
        // @ts-ignore
        this.emit("contract:node:delete", n)
        CoreIpc.fireEvent({type: "contract:node:delete", data: _.omit(n, ['peer'])})
        deletedNodes[n.id] = true;
        return;
      }

      /** 1) Add new node. */

      let oldNode = this._nodesMap.get(n.id)!;
      if(!oldNode){
        this._nodesMap
          .set(n.id, n)
          .set(n.wallet, n)
          .set(n.peerId, n)
        log(`New node info added to chain %o`, n)
        // @ts-ignore
        this.emit("contract:node:add", n)
        CoreIpc.fireEvent({type: "contract:node:add", data: n})
        addedNodes.push(n);
        return;
      }
      /**
       * 4) Edit isDeployer
       * 5) Edit node roles
       */
      if(oldNode.isDeployer !== n.isDeployer || oldNode.roles.join(',') !== n.roles.join(',')) {
        this._nodesMap
          .set(n.id, n)
          .set(n.wallet, n)
          .set(n.peerId, n)
        log(`Node info changed on chain %o`, {old: oldNode, new: n})
        // @ts-ignore
        this.emit("contract:node:edit", n, oldNode)
        CoreIpc.fireEvent({
          type: "contract:node:edit",
          data: {
            nodeInfo: {...n},
            oldNodeInfo: {...oldNode},
          }
        })
        return;
      }
    })

    this._nodesList = [
      /** filter deleted nodes */
      ...this._nodesList.filter(n => !deletedNodes[n.id]),
      /** add new nodes */
      ...addedNodes
    ]
    log(`nodes list updated.`);
  }

  async updateCache() {
    let {nodeManager: nodeManagerConfigs} = this.network.configs.net;
    while (true) {
      await timeout(24*60*60e3 + Math.random()*60*60e3);
      log(`check for updating NodeManager cached data.`)
      try {
        const cachedData:NodeManagerData = await getNodeManagerDataFromCache(nodeManagerConfigs);

        const onchainLastEditTime = await this.getOnchainLastEditTime()

        if(cachedData.lastUpdateTime == onchainLastEditTime) {
          /** update expiration */
          await storeNodeManagerDataIntoCache(nodeManagerConfigs, cachedData)
          log(`cached data is the same as onchain data.`)
          continue;
        }

        log.error(`updating cache ...`);
        /** load from chain and store it into the redis. */
        await tryAndGetNodeManagerData(nodeManagerConfigs);
      }
      catch (e) {
        log.error(`error when updating cache %o`, e);
      }
    }
  }

  private async getOnchainLastEditTime(): Promise<number> {
    let {nodeManager: {address, network}} = this.network.configs.net;
    return eth.call(address, 'lastUpdateTime', [], NodeManagerAbi, network)
  }

  async watchNodesChange(nodeManagerInfo) {
    const {address, network} = nodeManagerInfo;
    while (true) {
      /** every 5 minutes */
      await timeout(5*60000);
      try {
        let lastUpdateTime;
        log(`checking for nodes list changes ...`)
        do {
          try {
            lastUpdateTime = await this.getOnchainLastEditTime()
          }catch (e) {
            log('loading lastUpdateTime failed. %o', e)
            await timeout(5000)
          }
        }while (!lastUpdateTime)
        lastUpdateTime = parseInt(lastUpdateTime);

        if(lastUpdateTime !== this.lastNodesUpdateTime) {
          log(`Muon nodes list changed on-chain %o`, {
            oldUpdateTime: this.lastNodesUpdateTime,
            newUpdateTime: lastUpdateTime
          })
          await this.onNodesChange();
        }
        else
          log('no change detected.')
      }
      catch (e) {
        console.log(`Network.NodeManagerPlugin.watchNodesChange`, e)
      }
    }
  }

  /**
   * @param index {string} - id/wallet/peerId of node
   */
  getNodeInfo(index: string): MuonNodeInfo|undefined {
    if(typeof index !== 'string') {
      console.log(`Expected string index but got non-string`, index);
      console.log(stackTrace());
      throw `muon.network.NodeManagerPlugin.getNodeInfo Expected string index but got non-string`
    }
    return this._nodesMap.get(index);
  }

  get currentNodeInfo(): MuonNodeInfo | undefined {
    return this.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
  }

  async getNodesList(): Promise<MuonNodeInfo[]> {
    return this._nodesList;
  }

  filterNodes(options: NodeFilterOptions): MuonNodeInfo[] {
    let result: MuonNodeInfo[]
    if(options.list) {
      result = options.list.map(n => this._nodesMap.get(n)!)
        .filter(n => !!n)
    }
    else {
      result = this._nodesList
    }

    /** make result unique */
    result = lodash.uniqBy(result, 'id')

    if(options.isDeployer != undefined)
      result = result.filter(n => n.isDeployer === options.isDeployer)
    if(options.excludeSelf)
      result = result.filter(n => n.wallet !== process.env.SIGN_WALLET_ADDRESS)
    return result
  }

  findNOnline(searchList: string[], count: number, options?:{timeout?: number, return?: string}): Promise<string[]> {
    options = {
      timeout: 15000,
      return: 'id',
      ...options
    }
    let peers = this.filterNodes({list: searchList})
    log(`finding ${count} of ${searchList.length} online peer ...`)
    const selfIndex = peers.findIndex(p => p.peerId === process.env.PEER_ID!)

    let responseList: string[] = []
    let n = count;
    if(selfIndex >= 0) {
      peers = peers.filter((_, i) => (i!==selfIndex))
      responseList.push(this.currentNodeInfo![options!.return!]);
      n--;
    }

    let resultPromise = new TimeoutPromise(
      options.timeout,
      `Finding ${count} from ${searchList.length} peer timed out`,
      {
        resolveOnTimeout: true,
        onTimeoutResult: () => {
          return responseList;
        }
      }
    );

    let pendingRequests = peers.length
    for(let i=0 ; i<peers.length ; i++) {
      this.findPeer(peers[i].peerId)
        .then(peer => {
          if(!peer)
            throw `peer ${peers[i].peerId} not found to check online status.`
          return this.remoteCall(peer, RemoteMethods.CheckOnline, {}, {timeout: options!.timeout})
        })
        .then(result => {
          if(result === "OK") {
            responseList.push(peers[i][options!.return!])
            if (--n <= 0)
              resultPromise.resolve(responseList);
          }
          else {
            throw `check online unknown response: ${result}`
          }
        })
        .catch(e => {
          log.error("check status error %O", e)
        })
        .finally(() => {
          if(--pendingRequests <= 0)
            resultPromise.resolve(responseList);
        })
    }

    return resultPromise.promise;
  }

  async isNodeOnline(node: string): Promise<boolean> {
    let nodeInfo: MuonNodeInfo = this.getNodeInfo(node)!;
    if(!nodeInfo)
      return false;
    const peer = await this.findPeer(nodeInfo.peerId);
    if(!peer)
      return false;
    const response = await this.remoteCall(peer, RemoteMethods.CheckOnline, {}, {timeout: 3000})
      .catch(e => 'error')
    return response === "OK"
  }

  @remoteMethod(RemoteMethods.CheckOnline)
  async __checkOnline(): Promise<string> {
    return "OK";
  }
}
