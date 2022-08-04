import BasePlugin from './base/base-plugin'
import TimeoutPromise from '../../common/timeout-promise'
import * as NetworkingIpc from '../../networking/ipc'
import { GroupInfo, NetworkInfo } from '../../networking/plugins/collateral-info'

export default class CollateralInfoPlugin extends BasePlugin{

  groupInfo: GroupInfo | null = null;
  networkInfo: NetworkInfo | null = null;
  peersWallet: {[index: string]: string} = {}
  walletsPeer: {[index: string]: string} = {}
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
        info = await NetworkingIpc.call(
          "get-collateral-info",
          {},
          {
            timeout: 5000,
            timeoutMessage: "Getting collateral info timed out"
          },
        );
      }catch (e) {
        console.log(`[${process.pid}] CoreCollateralInfo._loadCollateralInfo`, e);
      }
    }
    const { groupInfo, networkInfo, peersWallet, walletsPeer } = info

    this.groupInfo = groupInfo;
    this.networkInfo = networkInfo;
    this.peersWallet = peersWallet;
    this.walletsPeer = walletsPeer;

    this.emit('loaded');
    this.loading.resolve(true);
  }

  // TODO: not implemented
  getWallets(){
    return Object.keys(this.walletsPeer);
  }

  getPeerWallet(peerId) {
    if(typeof peerId === "string")
      return this.peersWallet[peerId];
    else {
      console.log("core.CollateralInfo.etPeerWallet", "PeerId is not string", {peerId})
      throw {message: "Invalid peerId "}
    }
      // return this.peersWallet[peerId.toB58String()];
  }

  getWalletPeerId(wallet): string | undefined {
    return this.walletsPeer[wallet];
  }

  get GroupId(): string | undefined{
    return this.groupInfo?.group;
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
