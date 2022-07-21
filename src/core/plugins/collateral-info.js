const BasePlugin = require('./base/base-plugin')
const TimeoutPromise = require('../../common/timeout-promise');
const { call: networkingIpcCall } = require('../../networking/ipc')

class CollateralInfoPlugin extends BasePlugin{

  groupInfo = null;
  networkInfo = null;
  peersWallet = {}
  walletsPeer = {}
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
        info = await networkingIpcCall(
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
    this.loading.resolve();
  }

  // TODO: not implemented
  getWallets(){
    return Object.keys(this.walletsPeer);
  }

  getPeerWallet(peerId) {
    if(typeof peerId === "string")
      return this.peersWallet[peerId];
    else
      return this.peersWallet[peerId.toB58String()];
  }

  getWalletPeerId(wallet) {
    return this.walletsPeer[wallet];
  }

  get GroupId(){
    return this.groupInfo?.group;
  }

  get TssThreshold(){
    return this.networkInfo?.tssThreshold;
  }

  get MinGroupSize(){
    return this.networkInfo?.minGroupSize;
  }

  get MaxGroupSize(){
    return this.networkInfo?.maxGroupSize;
  }

  waitToLoad(){
    return this.loading.promise;
  }

  isLoaded(){
    return this.loading.isFulfilled;
  }
}

module.exports = CollateralInfoPlugin;
