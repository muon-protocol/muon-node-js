import BaseNetworkPlugin from './base/base-network-plugin'
import TimeoutPromise from '../../common/timeout-promise'
const eth = require('../../utils/eth')
const {stackTrace, timeout} = require('../../utils/helpers')
import NodeManagerAbi from '../../data/NodeManager-ABI.json'
import {MuonNodeInfo} from "../../common/types";
import * as CoreIpc from '../../core/ipc'
import _ from 'lodash'
const chalk = require('chalk')
const log = require('../../common/muon-log')('muon:network:plugins:collateral')

export type GroupInfo = {
  isValid: boolean,
  group: string,
  sharedKey: string | null,
  partners: string[]
}

export type NodeFilterOptions = {
  list?: string[],
  isOnline?: boolean,
  isDeployer?: boolean,
  excludeSelf?: boolean
}

export type NetworkInfo = {
  tssThreshold: number,
  minGroupSize: number,
  maxGroupSize: number
}

export default class CollateralInfoPlugin extends BaseNetworkPlugin{

  groupInfo: GroupInfo;
  networkInfo: NetworkInfo | null = null;
  private _onlinePeers: {[index: string]: object} = {}

  private lastNodesUpdateTime: number;
  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "collateral loading timed out")

  async onInit() {
    let {nodeManager} = this.network.configs.net;
    log(`Loading network info from ${nodeManager.address} on the network ${nodeManager.network} ...`)
    await this._loadCollateralInfo();

    this.network.on('peer:discovery', this.onPeerDiscovery.bind(this));
    this.network.on('peer:connect', this.onPeerConnect.bind(this));
    this.network.on('peer:disconnect', this.onPeerDisconnect.bind(this));
  }

  get onlinePeers(): string[] {
    return Object.keys(this._onlinePeers)
  }

  get onlinePeersInfo(): MuonNodeInfo[] {
    return Object.keys(this._onlinePeers)
      .map(peerId => this.getNodeInfo(peerId)!)
      .filter(info => !!info)
  }

  private getNodeId(peerId): string {
    const id = this.getNodeInfo(peerId._idB58String)?.id || 'unknown'
    return `[${id}]:${peerId._idB58String}`
  }

  async onPeerDiscovery(peerId) {
    log(chalk.green(`peer discovered ${this.getNodeId(peerId)}`))
    // console.log("peer available", peerId)
    await this.waitToLoad();

    await timeout(5000);

    this._onlinePeers[peerId._idB58String] = await this.findPeer(peerId)
    this.updateNodeInfo(peerId._idB58String, {isOnline: true})
  }

  async onPeerConnect(peerId) {
    log(chalk.green(`peer connected ${this.getNodeId(peerId)}`))
    await this.waitToLoad();

    await timeout(5000);

    this._onlinePeers[peerId._idB58String] = await this.findPeer(peerId);
    this.updateNodeInfo(peerId._idB58String, {isOnline: true})
  }

  onPeerDisconnect(peerId) {
    log(chalk.red(`peer disconnected ${this.getNodeId(peerId)}`))
    // console.log("peer not available", peerId)
    delete this._onlinePeers[peerId._idB58String];
    this.updateNodeInfo(peerId._idB58String, {isOnline: false})
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

    this.emit('loaded');
    this.loading.resolve(true);
  }

  async loadNetworkInfo(nodeManagerInfo): Promise<{lastUpdateTime: number, allNodes: MuonNodeInfo[]}>{
    const {address, network} = nodeManagerInfo;

    let rawResult;
    do {
      try {
        rawResult = await eth.call(address, 'info', [], NodeManagerAbi, network)
      }catch (e) {
        log('loading network info failed. %o', e)
        await timeout(5000)
      }
    }while(!rawResult)

    return {
      lastUpdateTime: parseInt(rawResult._lastUpdateTime),
      allNodes: rawResult._nodes
        .filter(item => item.active)
        .map(item => ({
          id: BigInt(item.id).toString(),
          wallet: item.nodeAddress,
          peerId: item.peerId,
          isDeployer: item.isDeployer,
          isOnline: item.nodeAddress === process.env.SIGN_WALLET_ADDRESS || !!this._onlinePeers[item.peerId]
        }))
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
      .filter(id => !newIdList.includes(id))
    nodesToRemove.forEach(id => {
      let oldNode = this._nodesMap.get(id)!;
      this._nodesMap.delete(oldNode.id)
      this._nodesMap.delete(oldNode.wallet)
      this._nodesMap.delete(oldNode.peerId)
      log(`Node info deleted from chain %o`, oldNode)
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
        this.emit("collateral:node:edit", n, oldNode)
        CoreIpc.fireEvent({
          type: "collateral:node:edit",
          data: {
            nodeInfo: {...n, isOnline: !!this._onlinePeers[n.peerId]},
            oldNodeInfo: {...oldNode, isOnline: !!this._onlinePeers[oldNode.peerId]},
          }
        })
        return;
      }
    })

    this._nodesList = allNodes;
    this.groupInfo.partners = allNodes.map(n => n.id)
  }

  async watchNodesChange(nodeManagerInfo) {
    const {address, network} = nodeManagerInfo;
    while (true) {
      /** every 20 seconds */
      await timeout(20000);
      try {
        let lastUpdateTime = await eth.call(address, 'lastUpdateTime', [], NodeManagerAbi, network)
        lastUpdateTime = parseInt(lastUpdateTime);

        if(lastUpdateTime !== this.lastNodesUpdateTime) {
          log("Muon nodes list changed on-chain.")
          await this.onNodesChange();
        }
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
      stackTrace();
      throw `Expected string index but got non-string`
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
    return Object.keys(this._onlinePeers)
      .map(peerId => this.getNodeInfo(peerId))
      .filter(info => !!info).length + 1 >= this.TssThreshold
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

  filterNodes(options: NodeFilterOptions): MuonNodeInfo[] {
    let result: MuonNodeInfo[]
    if(options.list) {
      result = options.list.map(n => this._nodesMap.get(n)!)
        .filter(n => !!n)
    }
    else {
      result = this._nodesList
    }
    if(options.isDeployer)
      result = result.filter(n => n.isDeployer)
    if(options.isOnline)
      result = result.filter(n => n.isOnline)
    if(options.excludeSelf)
      result = result.filter(n => n.wallet !== process.env.SIGN_WALLET_ADDRESS)
    return result
  }
}
