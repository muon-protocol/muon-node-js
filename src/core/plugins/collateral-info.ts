import BasePlugin from './base/base-plugin'
import TimeoutPromise from '../../common/timeout-promise'
import * as NetworkIpc from '../../network/ipc'
import { GroupInfo, NetworkInfo } from '../../network/plugins/collateral-info'
import {MuonNodeInfo} from "../../common/types";

export default class CollateralInfoPlugin extends BasePlugin{

  groupInfo: GroupInfo | null = null;
  networkInfo: NetworkInfo | null = null;
  private allowedWallets: string[] = []

  private _nodesList: MuonNodeInfo;
  private _nodesMap: Map<string, MuonNodeInfo> = new Map<string, MuonNodeInfo>();
  /**
   * @type {TimeoutPromise}
   */
  loading = new TimeoutPromise(0, "collateral loading timedout");

  async onStart(){
    super.onStart();
    this._loadCollateralInfo();

    // // TODO: check more this change
    // this.muon.once('peer:connect', () => {
    //   console.log('first node connected ...')
    //   // Listen to contract events and inform any changes.
    //   // TODO: uncomment this. (commented for debug)
    //   // this._watchContractEvents();
    //
    //   this._loadCollateralInfo();
    // })
  }

  async _loadCollateralInfo(){
    let info;
    while(!info) {
      try {
        info = await NetworkIpc.getCollateralInfo({timeout: 0});
      }catch (e) {
        console.log(`[${process.pid}] CoreCollateralInfo._loadCollateralInfo`, e);
      }
    }
    const { groupInfo, networkInfo, nodesList } = info

    this.groupInfo = groupInfo;
    this.networkInfo = networkInfo;

    this._nodesList = nodesList;
    nodesList.forEach(n => {
      this._nodesMap
        .set(n.id, n)
        .set(n.wallet, n)
        .set(n.peerId, n)
      this.allowedWallets.push(n.wallet);
    })

    this.emit('loaded');
    this.loading.resolve(true);
  }

  // TODO: not implemented
  getAllowedWallets(){
    return this.allowedWallets;
  }

  /**
   * @param index {string} - id/wallet/peerId of node
   */
  getNodeInfo(index: string): MuonNodeInfo|undefined {
    return this._nodesMap.get(index);
  }

  get TssThreshold(): number{
    if(this.networkInfo)
      return this.networkInfo?.tssThreshold;
    else
      return Infinity;
  }

  get MinGroupSize(){
    return this.networkInfo?.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo?.maxGroupSize;
  }

  waitToLoad(): Promise<any>{
    return this.loading.promise;
  }

  isLoaded(): boolean{
    return this.loading.isFulfilled;
  }
}
