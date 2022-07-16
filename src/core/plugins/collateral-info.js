const BasePlugin = require('./base/base-plugin')
const { call: networkingIpcCall } = require('../../networking/ipc')

class CollateralInfoPlugin extends BasePlugin{

  groupInfo = null;
  networkInfo = null;
  peersWallet = {}
  walletsPeer = {}

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
    const { groupInfo, networkInfo, peersWallet, walletsPeer } = await networkingIpcCall("get-collateral-info")

    this.groupInfo = groupInfo;
    this.networkInfo = networkInfo;
    this.peersWallet = peersWallet;
    this.walletsPeer = walletsPeer;

    this.emit('loaded');
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
}

module.exports = CollateralInfoPlugin;
