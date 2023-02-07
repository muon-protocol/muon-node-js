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
import {broadcastHandler, remoteApp, remoteMethod} from "./base/app-decorators.js";
import NodeCache from 'node-cache';
import lodash from "lodash";
import axios from "axios";

const require = createRequire(import.meta.url);
const NodeManagerAbi = require('../../data/NodeManager-ABI.json')
const MuonNodesPaginationAbi = require('../../data/MuonNodesPagination-ABI.json')
const log = logger('muon:network:plugins:collateral')

const HEARTBEAT_EXPIRE = parseInt(process.env.HEARTBEAT_EXPIRE!) || 20*60*1000; // Keep heartbeet in memory for 5 minutes

const heartbeatCache = new NodeCache({
  stdTTL: HEARTBEAT_EXPIRE/1000,
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 60,
  useClones: false,
});

export type GroupInfo = {
  isValid: boolean,
  group: string,
  sharedKey: string | null,
  partners: string[]
}

export type NodeFilterOptions = {
  list?: string[],
  isOnline?: boolean,
  isConnected?: boolean
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
export default class CollateralInfoPlugin extends CallablePlugin{

  groupInfo: GroupInfo;
  networkInfo: NetworkInfo | null = null;

  private lastNodesUpdateTime: number;
  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "collateral loading timed out")

  async onInit() {
    await super.onInit()

    let {nodeManager} = this.network.configs.net;
    log(`Loading network info from ${nodeManager.address} on the network ${nodeManager.network} ...`)
    await this._loadCollateralInfo();

    // @ts-ignore
    this.network.on('peer:connect', this.onPeerConnect.bind(this));
  }

  async onStart() {
    await super.onStart()

    // this.__broadcastHeartbeat()
    // heartbeatCache.on("del", this.onHeartbeatExpired.bind(this));
  }

  private async __broadcastHeartbeat() {
    while(true) {
      try {
        log('broadcasting heartbeat')
        this.broadcast("HB")
      }catch (e) {
        log(`error when broadcasting hurt beat`)
      }

      /** delay between each broadcast */
      await timeout(HEARTBEAT_EXPIRE/2 + Math.random() * 60e3)
    }
  }

  @broadcastHandler
  async __broadcastHandler(data, callerInfo: MuonNodeInfo) {
    if(data === 'HB') {
      log(`Heartbeat arrived from ${callerInfo.id}`)
      this.onPeerOnline(callerInfo.peerId);
    }
  }

  onHeartbeatExpired(key, value){
    log(`heartbeat expired for node ${key}`)
    this.onPeerOffline(key);
  }

  private onPeerOnline(peerId: string) {
    // heartbeatCache.set(peerId, Date.now())
    // this.updateNodeInfo(peerId, {isOnline: true})
    // log(`peer[${peerId}] is online now`)
    // CoreIpc.fireEvent({
    //   type: "peer:online",
    //   data: peerId,
    // });
  }

  private onPeerOffline(peerId: string) {
    // this.updateNodeInfo(peerId, {isOnline: false})
    // log(`peer[${peerId}] is offline now`)
    // CoreIpc.fireEvent({
    //   type: "peer:offline",
    //   data: peerId,
    // });
  }

  get onlinePeers(): string[] {
    return heartbeatCache.keys()
  }

  get onlinePeersInfo(): MuonNodeInfo[] {
    return this.onlinePeers
      .map(peerId => this.getNodeInfo(peerId)!)
      .filter(info => !!info)
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

    this.onPeerOnline(peerInfo.peerId)
  }

  private updateNodeInfo(index: string, dataToMerge: object) {
    let nodeInfo = this.getNodeInfo(index)!;
    if(nodeInfo) {
      log(`updating node [${nodeInfo.id}]`, dataToMerge);
      /** update fields */
      // console.log("((((((", JSON.stringify(this._nodesList.map(n => n.isOnline)))
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

  async _loadCollateralInfo(){
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

    this.groupInfo = {
      isValid: true,
      group: "1",
      sharedKey: null,
      partners: allNodes.map(n => n.id)
    }

    log('Collateral info loaded.');

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
        await timeout(5000)
      }
    }while(!rawResult)

    return {
      lastUpdateTime: parseInt(rawResult._lastUpdateTime),
      allNodes: rawResult._nodes
        .filter(item => item.active)
        .map((item): MuonNodeInfo => ({
          id: BigInt(item.id).toString(),
          staker: item.stakerAddress,
          wallet: item.nodeAddress,
          peerId: item.peerId,
          isDeployer: item.isDeployer,
          isOnline: item.nodeAddress === process.env.SIGN_WALLET_ADDRESS || heartbeatCache.has(item.peerId)
        }))
    }
  }

  // private async getInfo(address: string, network: string) {
  //   return {
  //     _lastUpdateTime: await eth.call(address, 'lastUpdateTime', [], NodeManagerAbi, network),
  //     _nodes: await axios.get('http://192.3.136.81/allNodes').then(({data}) => data)
  //   }
  // }

  private async paginateAndGetInfo(paginationAddress:string, nodeManagerAddress: string, network: string) {
    const itemPerPage = 2000;
    const lastNodeIdStr: string = await eth.call(nodeManagerAddress, 'lastNodeId', [], NodeManagerAbi, network)
    const lastNodeId = parseInt(lastNodeIdStr)

    const pagesToRequest = new Array(Math.ceil(lastNodeId / itemPerPage)).fill(0).map((_,i) => i)

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

    let {lastUpdateTime, allNodes} = await this.loadNetworkInfo(nodeManager);
    this.lastNodesUpdateTime = lastUpdateTime;


    /**
     * 2) Remove node by Admin
     * 3) Deactivate node by collateral address
     */
    const newIdList = allNodes.map(n => n.id);
    const nodesToRemove = this._nodesList
      .map(n => n.id)
      .filter(id => !newIdList.includes(id));
    nodesToRemove.forEach(id => {
      let oldNode = this._nodesMap.get(id)!;
      this._nodesMap.delete(oldNode.id)
      this._nodesMap.delete(oldNode.wallet)
      this._nodesMap.delete(oldNode.peerId)
      log(`Node info deleted from chain %o`, oldNode)
      // @ts-ignore
      this.emit("collateral:node:delete", oldNode)
      CoreIpc.fireEvent({type: "collateral:node:delete", data: _.omit(oldNode, ['peer'])})
    })

    allNodes.forEach(n => {
      let oldNode = this._nodesMap.get(n.id);
      /** 1) Add new node. */
      if(!oldNode){
        this._nodesMap
          .set(n.id, n)
          .set(n.wallet, n)
          .set(n.peerId, n)
        log(`New node info added to chain %o`, n)
        // @ts-ignore
        this.emit("collateral:node:add", n)
        CoreIpc.fireEvent({type: "collateral:node:add", data: n})
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
        this.emit("collateral:node:edit", n, oldNode)
        CoreIpc.fireEvent({
          type: "collateral:node:edit",
          data: {
            nodeInfo: {...n, isOnline: heartbeatCache.has(n.peerId)},
            oldNodeInfo: {...oldNode, isOnline: heartbeatCache.has(oldNode.peerId)},
          }
        })
        return;
      }
    })

    this._nodesList = allNodes;
    this.groupInfo.partners = allNodes.map(n => n.id)
    log(`nodes list updated.`)
  }

  async watchNodesChange(nodeManagerInfo) {
    const {address, network} = nodeManagerInfo;
    while (true) {
      /** every 20 seconds */
      await timeout(60000);
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
        console.log(`Network.CollateralInfoPlugin.watchNodesChange`, e)
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
      throw `muon.network.CollateralPlugin.getNodeInfo Expected string index but got non-string`
    }
    return this._nodesMap.get(index);
  }

  get TssThreshold(): number{
    if(!!this.networkInfo)
      return this.networkInfo?.tssThreshold
    else
      return Infinity;
  }

  hasEnoughPartners(): boolean {
    /**
     * onlinePartners not include current node
     */
    return this.onlinePeers
      .map(peerId => this.getNodeInfo(peerId))
      .filter(info => !!info).length + 1 >= this.TssThreshold
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

  async getNodesList() {
    await this.waitToLoad();
    let connectedPeers = this.network.getConnectedPeers();
    return this._nodesList.map(n => {
      let res = {...n};
      if(connectedPeers[n.peerId])
        res.isOnline = true;
      return res;
    });
  }

  waitToLoad(){
    return this.loading.promise;
  }

  isLoaded(): boolean{
    return this.loading.isFulfilled;
  }

  getConnectedPeerIds(): string[] {
    let list = this.network.libp2p.connectionManager.getConnections()
      .filter(cnn => cnn.stat.status === 'OPEN')
    let uniqueList = {}
    list.forEach(cnn => {
      uniqueList[cnn.remotePeer.toString()] = true
    })
    return Object.keys(uniqueList);
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

    if(options.isConnected !== undefined) {
      let connectedList = this.getConnectedPeerIds()
      result = result.filter(n => connectedList.includes(n.peerId)===options.isConnected)
    }
    if(options.isDeployer != undefined)
      result = result.filter(n => n.isDeployer === options.isDeployer)
    if(options.isOnline != undefined)
      result = result.filter(n => n.isOnline === options.isOnline)
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
