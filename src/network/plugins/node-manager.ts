import CallablePlugin from './base/callable-plugin.js'
import TimeoutPromise from '../../common/timeout-promise.js'
import * as eth from '../../utils/eth.js'
import {stackTrace, timeout} from '../../utils/helpers.js'
import {MuonNodeInfo} from "../../common/types";
import * as CoreIpc from '../../core/ipc.js'
import _ from 'lodash'
import chalk from 'chalk'
import {logger} from '@libp2p/logger'
import { createRequire } from "module";
import {peerId2Str} from "../utils.js";
import {remoteApp, remoteMethod} from "./base/app-decorators.js";
import { peerIdFromString } from '@libp2p/peer-id'
import lodash from "lodash";

const require = createRequire(import.meta.url);
const NodeManagerAbi = require('../../data/NodeManager-ABI.json')
const MuonNodesPaginationAbi = require('../../data/MuonNodesPagination-ABI.json')
const log = logger('muon:network:plugins:node-manager')


export type NodeFilterOptions = {
  list?: string[],
  isDeployer?: boolean,
  excludeSelf?: boolean
}

export type NetworkInfo = {
  tssThreshold: number,
  minGroupSize: number,
  maxGroupSize: number
}

const RemoteMethods = {
  CheckOnline: 'CKON',
}

@remoteApp
export default class NodeManagerPlugin extends CallablePlugin{
  networkInfo: NetworkInfo | null = null;

  private lastNodesUpdateTime: number;
  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "contract loading timed out")

  async onInit() {
    await super.onInit()

    let {nodeManager} = this.network.configs.net;
    log(`Loading network info from ${nodeManager.address} on the network ${nodeManager.network} ...`)
    // Waits a random time(0-5 secs) to avoid calling
    // RPC nodes by all network nodes at the same time
    // When the network restarts
    await timeout(Math.floor(Math.random()*5*1e3));
    await this._loadContractInfo();

    // @ts-ignore
    this.network.on('peer:connect', this.onPeerConnect.bind(this));
  }

  async onStart() {
    await super.onStart()
  }

  private getNodeId(peerId): string {
    const id = this.getNodeInfo(peerId2Str(peerId))?.id || 'unknown'
    return `[${id}]:${peerId2Str(peerId)}`
  }

  async onPeerConnect(peerId) {
    log(chalk.green(`peer connected ${this.getNodeId(peerId)}`))
    await this.waitToLoad();

    const peerInfo: MuonNodeInfo|undefined = this.getNodeInfo(peerId2Str(peerId));
    if(!peerInfo){
      log(`unknown peer connect ${peerId2Str(peerId)}`)
      return;
    }

    await timeout(5000);
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

  async _loadContractInfo(){
    let {tss, nodeManager} = this.network.configs.net;

    this.networkInfo = {
      tssThreshold: parseInt(tss.threshold),
      minGroupSize: parseInt(tss.min || tss.threshold),
      maxGroupSize: parseInt(tss.max)
    }

    let {lastUpdateTime, allNodes} = await this.loadNetworkInfo(nodeManager);
    this.lastNodesUpdateTime = lastUpdateTime;
    this.watchNodesChange(nodeManager)

    this._nodesList = allNodes;
    allNodes.forEach(n => {
      this._nodesMap
        .set(n.id, n)
        .set(n.wallet, n)
        .set(n.peerId, n)
    })

    log('contract info loaded.');

    // @ts-ignore
    this.emit('loaded');
    this.loading.resolve(true);
  }

  async loadNetworkInfo(nodeManagerInfo): Promise<{lastUpdateTime: number, allNodes: MuonNodeInfo[]}>{
    const {address, network, pagination: paginationContractAddress} = nodeManagerInfo;

    let rawResult;
    do {
      try {
        if(!!paginationContractAddress) {
          rawResult = await this.paginateAndGetInfo(
            paginationContractAddress,
            address,
            network
          )
        }
        else {
          rawResult = await eth.call(address, 'info', [], NodeManagerAbi, network)
        }
      }catch (e) {
        log('loading network info failed. %o', e)
        await timeout(Math.floor(Math.random()*1*60*1000)+5000)
      }
    }while(!rawResult)

    let allNodes = rawResult._nodes
      .filter(item => {
        if (!item.active)
          return false;
        try {
          peerIdFromString(item.peerId)
          return true
        }
        catch (e) {
          return false;
        }
      })
      .map((item): MuonNodeInfo => ({
        id: BigInt(item.id).toString(),
        active: true,
        staker: item.stakerAddress,
        wallet: item.nodeAddress,
        peerId: item.peerId,
        isDeployer: item.isDeployer,
      }))

    let exist = {};
    allNodes = allNodes.filter(p => {
      if(exist[p.wallet] || exist[p.peerId])
        return false;

      exist[p.peerId] = true
      exist[p.wallet] = true

      return true
    })

    return {
      lastUpdateTime: parseInt(rawResult._lastUpdateTime),
      allNodes
    }
  }

  private async paginateAndGetInfo(paginationAddress:string, nodeManagerAddress: string, network: string) {
    const itemPerPage = 1200;
    const lastNodeIdStr: string = await eth.call(nodeManagerAddress, 'lastNodeId', [], NodeManagerAbi, network)
    const lastNodeId = parseInt(lastNodeIdStr)

    const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)
    log(`loading nodes info: size: ${itemPerPage}, pages: [${pagesToRequest.join(',')}]`)

    const pagesData = await Promise.all(pagesToRequest.map(page => {
      const startIndex = page*itemPerPage + 1;
      const endIndex = Math.min(startIndex+itemPerPage-1, lastNodeId)
      return eth.call(
        paginationAddress,
        'getAllNodes',
        [`0x${startIndex.toString(16)}`,`0x${endIndex.toString(16)}`],
        MuonNodesPaginationAbi,
        network
      )
    }))

    return {
      _lastUpdateTime: await eth.call(nodeManagerAddress, 'lastUpdateTime', [], NodeManagerAbi, network),
      _nodes: [].concat(...pagesData)
    }
  }

  async paginateAndGetEditedNodes(paginationAddress:string, nodeManagerAddress: string, network: string, timestamp: number) {
    const itemPerPage = 1200;
    const lastNodeId: number = parseInt(await eth.call(nodeManagerAddress, 'lastNodeId', [], NodeManagerAbi, network))

    const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)
    log(`loading node changes: size: ${itemPerPage}, pages: [${pagesToRequest.join(',')}]`)

    const pagesData = await Promise.all(pagesToRequest.map(page => {
      const startIndex = page*itemPerPage + 1;
      const endIndex = Math.min(startIndex+itemPerPage-1, lastNodeId)
      return eth.call(
        paginationAddress,
        'getEditedNodes',
        [
          `0x${timestamp.toString(16)}`,
          `0x${startIndex.toString(16)}`,
          `0x${endIndex.toString(16)}`
        ],
        MuonNodesPaginationAbi,
        network
      )
    }))

    // @ts-ignore
    const _nodes = [].concat(...pagesData).filter(node => parseInt(node.id)>0)

    return {
      // @ts-ignore
      _lastUpdateTime: _nodes.reduce((max, node) => Math.max(max, parseInt(node.lastEditTime)), 0),
      _nodes
    }
  }

  async loadNetworkChanges(nodeManagerInfo): Promise<{lastUpdateTime: number, allNodes: MuonNodeInfo[]}> {
    const {address, network, pagination: paginationContractAddress} = nodeManagerInfo;
    const fromTimestamp = this.lastNodesUpdateTime;

    let rawResult;
    do {
      try {
        if(!!paginationContractAddress) {
          rawResult = await this.paginateAndGetEditedNodes(
            paginationContractAddress,
            address,
            network,
            fromTimestamp
          )
        }
        else {
          rawResult = await eth.call(address, 'info', [], NodeManagerAbi, network)
          rawResult._nodes = rawResult._nodes
            .filter(item => item.lastEditTime > fromTimestamp)
        }
      }catch (e) {
        log('loading network info failed. %o', e)
        await timeout(5000)
      }
    }while(!rawResult)

    const allNodes = rawResult._nodes
      .map((item): MuonNodeInfo => ({
        id: BigInt(item.id).toString(),
        active: item.active,
        staker: item.stakerAddress,
        wallet: item.nodeAddress,
        peerId: item.peerId,
        isDeployer: item.isDeployer,
      }))

    return {
      lastUpdateTime: parseInt(rawResult._lastUpdateTime),
      allNodes
    };
  }

  /**
   * All events that changes the lastUpdateTime:
   *
   * 1) Add new node.
   * 2) Remove node by Admin
   * 3) Deactivate node by collateral address
   * 4) Edit nodeAddress
   * 5) Edit PeerId
   * 6) Edit isDeployer
   */
  async onNodesChange() {
    log(`nodes list updating ...`)
    let {nodeManager} = this.network.configs.net;

    let {lastUpdateTime, allNodes: changes} = await this.loadNetworkChanges(nodeManager);
    this.lastNodesUpdateTime = lastUpdateTime;
    log(`contract data changed: ${changes.length} nodes`)

    const addedNodes: any[] = []
    const deletedNodes = {}
    changes.forEach(n => {
      /** A violent node may use another node's peerId. */
      if(!!this._nodesMap[n.peerId]?.id && n.id !== this._nodesMap[n.peerId]?.id) {
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
       * 4) Edit nodeAddress
       * 5) Edit PeerId
       * 6) Edit isDeployer
       */
      if(oldNode.wallet !== n.wallet || oldNode.peerId !== n.peerId || oldNode.isDeployer !== n.isDeployer) {
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

  async watchNodesChange(nodeManagerInfo) {
    const {address, network} = nodeManagerInfo;
    while (true) {
      /** every 20 seconds */
      await timeout(5*60000);
      try {
        let lastUpdateTime;
        log(`checking for nodes list changes ...`)
        do {
          try {
            lastUpdateTime = await eth.call(address, 'lastUpdateTime', [], NodeManagerAbi, network)
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

  get TssThreshold(): number{
    if(!!this.networkInfo)
      return this.networkInfo?.tssThreshold
    else
      return Infinity;
  }

  get currentNodeInfo(): MuonNodeInfo | undefined {
    return this.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!);
  }

  get MinGroupSize(){
    return this.networkInfo?.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo?.maxGroupSize;
  }

  async getNodesList(): Promise<MuonNodeInfo[]> {
    await this.waitToLoad();
    return this._nodesList;
  }

  waitToLoad(){
    return this.loading.promise;
  }

  isLoaded(): boolean{
    return this.loading.isFulfilled;
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

  @remoteMethod(RemoteMethods.CheckOnline)
  async __checkOnline(): Promise<string> {
    return "OK";
  }
}
