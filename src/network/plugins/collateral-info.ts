import BaseNetworkPlugin from './base/base-network-plugin'
import TimeoutPromise from '../../common/timeout-promise'
const eth = require('../../utils/eth')
const {stackTrace} = require('../../utils/helpers')
import NodeManagerAbi from '../../data/NodeManager-ABI.json'
import {MuonNodeInfo} from "../../common/types";
const _ = require('lodash')

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

  groupInfo: GroupInfo | null = null;
  networkInfo: NetworkInfo | null = null;
  onlinePeers: {[index: string]: boolean} = {}

  private _nodesList: MuonNodeInfo;
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

    let nodeInfo = this.getNodeInfo(peerId._idB58String)
    if(!nodeInfo) {
      console.log(`network.CollateralInfo.onPeerDiscovery`, "Unknown peer connect", peerId);
      return;
    }
    this.onlinePeers[peerId._idB58String] = true;
    nodeInfo.peer = await this.findPeer(peerId)
  }

  async onPeerConnect(peerId) {
    await this.waitToLoad();

    // console.log("peer connected", peerId)
    const nodeInfo = this.getNodeInfo(peerId._idB58String)
    if(!nodeInfo) {
      if(process.env.VERBOSE) {
        console.log(`Unknown peer ${peerId} connected to network and ignored.`)
      }
      return;
    }

    this.onlinePeers[peerId._idB58String] = true
    nodeInfo.peer = await this.findPeer(peerId)
  }

  onPeerDisconnect(disconnectedPeer) {
    // console.log("peer not available", peerId)
    delete this.onlinePeers[disconnectedPeer._idB58String];
    const nodeInfo = this.getNodeInfo(disconnectedPeer._idB58String)
    if(nodeInfo) {
      delete nodeInfo.peer
    }
  }

  async _loadCollateralInfo(){
    let {tss, nodeManager} = this.network.configs.net;

    this.networkInfo = {
      tssThreshold: parseInt(tss.threshold),
      minGroupSize: parseInt(tss.min || tss.threshold),
      maxGroupSize: parseInt(tss.max)
    }

    let nodes = await this.loadNetworkNodes(nodeManager);
    nodes = nodes
      .filter(n => n.active)
      .map(n => ({
        id: n.id,
        wallet: n.nodeAddress,
        peerId: n.peerId
      }))
    console.log(nodes)

    this._nodesList = nodes;
    nodes.forEach(n => {
      this._nodesMap
        .set(n.id, n)
        .set(n.wallet, n)
        .set(n.peerId, n)
    })

    this.groupInfo = {
      isValid: true,
      group: "1",
      sharedKey: null,
      partners: nodes.map(n => n.wallet)
    }

    if(process.env.VERBOSE) {
      console.log('CollateralInfo._loadCollateralInfo: Info loaded.');
    }

    this.emit('loaded');
    this.loading.resolve(true);
  }

  async loadNetworkNodes(nodeManagerInfo) {
    const {address, network} = nodeManagerInfo;
    const result = await eth.call(address, 'getAllNodes', [], NodeManagerAbi, network)
    return result;
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
    return Object.keys(this.onlinePeers).length + 1 >= this.TssThreshold
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
