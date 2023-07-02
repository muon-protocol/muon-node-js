import BasePlugin from './base/base-plugin.js'
import TimeoutPromise from '../../common/timeout-promise.js'
import * as NetworkIpc from '../../network/ipc.js'
import {NodeFilterOptions} from '../../network/plugins/node-manager.js'
import {MuonNodeInfo} from "../../common/types";
import {logger} from '@libp2p/logger'
import lodash from 'lodash'

const log = logger('muon:core:plugins:node-manager')

export default class NodeManagerPlugin extends BasePlugin{

  private _nodesList: MuonNodeInfo[];
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "contract loading timed out");

  async onInit(): Promise<any> {
    await super.onInit();

    await this._loadNodeManagerData();
  }

  async onStart(){
    await super.onStart();

    this.muon.on("contract:node:add", this.onNodeAdd.bind(this));
    this.muon.on("contract:node:edit", this.onNodeEdit.bind(this));
    this.muon.on("contract:node:delete", this.onNodeDelete.bind(this));
  }

  private updateNodeInfo(index: string, dataToMerge: object, keysToDelete?:string[]) {
    let nodeInfo = this.getNodeInfo(index)!;
    if (nodeInfo) {
      /** update fields */
      if (dataToMerge) {
        Object.keys(dataToMerge).forEach(key => {
          nodeInfo[key] = dataToMerge[key];
        })
      }
      /** delete keys */
      if (keysToDelete) {
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

  async onNodeAdd(nodeInfo: MuonNodeInfo) {
    await this.waitToLoad()
    log(`Core.NodeManager.onNodeAdd %o`, nodeInfo)
    this._nodesList.push(nodeInfo)

    this._nodesMap
      .set(nodeInfo.id, nodeInfo)
      .set(nodeInfo.wallet, nodeInfo)
      .set(nodeInfo.peerId, nodeInfo)
  }

  async onNodeEdit(data: {nodeInfo: MuonNodeInfo, oldNodeInfo: MuonNodeInfo}) {
    await this.waitToLoad()
    const {nodeInfo, oldNodeInfo} = data
    log(`Core.NodeManager.onNodeEdit %o`, {nodeInfo, oldNodeInfo})
    const listIndex = this._nodesList.findIndex(item => item.id === nodeInfo.id)
    this._nodesList.splice(listIndex, 1, nodeInfo);

    this._nodesMap
      .set(nodeInfo.id, nodeInfo)
      .set(nodeInfo.wallet, nodeInfo)
      .set(nodeInfo.peerId, nodeInfo)
  }

  async onNodeDelete(nodeInfo: MuonNodeInfo) {
    await this.waitToLoad()
    log(`Core.NodeManager.onNodeDelete %o`, nodeInfo)

    /** remove from nodesList */
    const idx1 = this._nodesList.findIndex(item => item.id === nodeInfo.id)
    this._nodesList.splice(idx1, 1);

    /** remove from nodesMap */
    this._nodesMap.delete(nodeInfo.id)
    this._nodesMap.delete(nodeInfo.wallet)
    this._nodesMap.delete(nodeInfo.peerId)
  }

  private async _loadNodeManagerData(){
    let info;
    while(!info) {
      try {
        info = await NetworkIpc.getNodeManagerData({timeout: 1000});
      }catch (e) {
        log(`process[${process.pid}] contract info loading failed %o`, e);
      }
    }
    const { nodesList } = info

    this._nodesList = nodesList;
    nodesList.forEach(n => {
      this._nodesMap
        .set(n.id, n)
        .set(n.wallet, n)
        .set(n.peerId, n)
    })

    log('Contract info loaded.');
    // @ts-ignore
    this.emit('loaded');
    this.loading.resolve(true);
  }

  /**
   * @param index {string} - id/wallet/peerId of node
   */
  getNodeInfo(index: string): MuonNodeInfo|undefined {
    return this._nodesMap.get(index);
  }

  /**
   * @param index {string} - id/wallet/peerId of node
   */
  get currentNodeInfo(): MuonNodeInfo|undefined {
    return this._nodesMap.get(process.env.SIGN_WALLET_ADDRESS!);
  }

  waitToLoad(): Promise<any>{
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
}
