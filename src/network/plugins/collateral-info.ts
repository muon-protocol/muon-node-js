import BaseNetworkPlugin from './base/base-network-plugin'
import TimeoutPromise from '../../common/timeout-promise'
const eth = require('../../utils/eth')
const {stackTrace, timeout} = require('../../utils/helpers')
const { multiCall } = require('../../utils/multicall')
import NodeManagerAbi from '../../data/NodeManager-ABI.json'
import {MuonNodeInfo} from "../../common/types";
import * as CoreIpc from '../../core/ipc'
import _ from 'lodash'

export type GroupInfo = {
  isValid: boolean,
  group: string,
  sharedKey: string | null,
  partners: string[]
}

export type NetworkInfo = {
  tssThreshold: number,
  minGroupSize: number,
  maxGroupSize: number
}

export default class CollateralInfoPlugin extends BaseNetworkPlugin{

  groupInfo: GroupInfo;
  networkInfo: NetworkInfo | null = null;
  onlinePeers: {[index: string]: boolean} = {}

  private lastNodesUpdateTime;
  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "collateral loading timed out")

  async onStart(){
    super.onStart();
    this._loadCollateralInfo();

    this.network.on('peer:discovery', this.onPeerDiscovery.bind(this));
    this.network.on('peer:connect', this.onPeerConnect.bind(this));
    this.network.on('peer:disconnect', this.onPeerDisconnect.bind(this));

    // this.network.once('peer:connect', () => {
    //   console.log('first node connected ...')
    //   // Listen to contract events and inform any changes.
    //   // TODO: uncomment this. (commented for debug)
    //   // this._watchContractEvents();
    //
    //   this._loadCollateralInfo();
    // })
  }

  get onlinePeersInfo(): MuonNodeInfo[] {
    return Object.keys(this.onlinePeers)
      .map(peerId => this.getNodeInfo(peerId)!)
      .filter(info => !!info)
  }

  async onPeerDiscovery(peerId) {
    // console.log("peer available", peerId)
    await this.waitToLoad();

    this.onlinePeers[peerId._idB58String] = true
    this.updateNodeInfo(peerId._idB58String, {
      isOnline: true,
      peer: await this.findPeer(peerId)
    })
  }

  async onPeerConnect(peerId) {
    await this.waitToLoad();

    this.onlinePeers[peerId._idB58String] = true
    this.updateNodeInfo(peerId._idB58String, {
      isOnline: true,
      peer: await this.findPeer(peerId)
    })
  }

  onPeerDisconnect(peerId) {
    // console.log("peer not available", peerId)
    delete this.onlinePeers[peerId._idB58String];
    this.updateNodeInfo(peerId._idB58String, {isOnline: true}, ['peer'])
  }

  private updateNodeInfo(index: string, dataToMerge: object, keysToDelete?:string[]) {
    let nodeInfo = this.getNodeInfo(index)!;
    if(nodeInfo) {
      /** update fields */
      if(dataToMerge) {
        Object.keys(dataToMerge).forEach(key => {
          nodeInfo[key] = dataToMerge[key];
        })
      }
      /** delete keys */
      if(keysToDelete) {
        keysToDelete.forEach(key => {
          delete nodeInfo[key]
        })
      }
      /**
       * all three indexes id|wallet|peerId contains same object reference.
       * by changing peerId index other two indexes, will change too.
       */
      this._nodesMap.set(index, nodeInfo);
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

    if(process.env.VERBOSE) {
      console.log('CollateralInfo._loadCollateralInfo: Info loaded.');
    }

    this.emit('loaded');
    this.loading.resolve(true);
  }

  async loadNetworkInfo(nodeManagerInfo){
    const {address, network} = nodeManagerInfo;

    const contractCallContext = {
      reference: "get-muon-nodes-info",
      contractAddress: address,
      abi: NodeManagerAbi,
      calls: [{
        reference: "get-last-update-time",
        methodName: 'lastUpdateTime()',
        methodParameters: []
      },{
        reference: "get-nodes-list",
        methodName: 'getAllNodes',
        methodParameters: []
      }]
    }
    let rawResult = await multiCall(network, [contractCallContext])
    rawResult = rawResult[0].callsReturnContext;

    return {
      lastUpdateTime: parseInt(rawResult[0].returnValues[0]),
      allNodes: rawResult[1].returnValues
        .filter(item => item[4])
        .map(item => ({
          id: BigInt(item[0].hex).toString(),
          wallet: item[1],
          peerId: item[3],
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
      if(process.env.VERBOSE) {
        console.log(`Node info deleted from chain`, oldNode)
      }
      this.emit("node:delete", oldNode)
      CoreIpc.fireEvent({type: "node:delete", data: _.omit(oldNode, ['peer'])})
    })

    allNodes.forEach(n => {
      let oldNode = this._nodesMap.get(n.id);
      /** 1) Add new node. */
      if(!oldNode){
        this._nodesMap
          .set(n.id, n)
          .set(n.wallet, n)
          .set(n.peerId, n)
        if(process.env.VERBOSE) {
          console.log(`New node info added to chain`, n)
        }
        this.emit("node:add", n)
        CoreIpc.fireEvent({type: "node:add", data: n})
        return;
      }
      /**
       * 4) Edit nodeAddress
       * 5) Edit PeerId
       */
      if(oldNode.wallet !== n.wallet || oldNode.peerId !== n.peerId) {
        this._nodesMap
          .set(n.id, n)
          .set(n.wallet, n)
          .set(n.peerId, n)
        if(process.env.VERBOSE) {
          console.log(`Node info changed on chain`, {old: oldNode, new: n})
        }
        this.emit("node:edit", n)
        CoreIpc.fireEvent({type: "node:edit", data: _.omit(n, ['peer'])})
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
          if(process.env.VERBOSE) {
            console.log("Muon nodes list changed on-chain.")
          }
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

  hasEnoughPartners() {
    /**
     * onlinePartners not include current node
     */
    return Object.keys(this.onlinePeers)
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
    return this._nodesList;
  }

  waitToLoad(){
    return this.loading.promise;
  }

  isLoaded(): boolean{
    return this.loading.isFulfilled;
  }
}
