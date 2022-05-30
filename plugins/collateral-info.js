const BasePlugin = require('./base/base-plugin')

class CollateralInfoPlugin extends BasePlugin{

  groupInfo = null;
  networkInfo = null;
  peersWallet = {}
  walletsPeer = {}

  async onStart(){
    super.onStart();

    this.muon.once('peer:connect', () => {
      console.log('first node connected ...')
      // Listen to contract events and inform any changes.
      // TODO: uncomment this. (commented for debug)
      // this._watchContractEvents();

      this._loadCollateralInfo();
    })
  }

  async _loadCollateralInfo(){
    let {tss, collateralWallets} = this.muon.configs.net;
    this.networkInfo = {
      tssThreshold: parseInt(tss.threshold),
      minGroupSize: parseInt(tss.min || tss.threshold),
      maxGroupSize: parseInt(tss.max)
    }

    let parts = collateralWallets.map(cw => cw.split('@'))
    if(parts.findIndex(p => p.length !== 2) >= 0) {
      throw "Invalid collateral wallet config located at config/global/net.conf.json"
    }
    this.groupInfo = {
      isValid: true,
      group: "1",
      sharedKey: null,
      partners: parts.map(item => item[0])
    }
    parts.forEach(([wallet, peerId]) => {
      this.peersWallet[peerId] = wallet
      this.walletsPeer[wallet] = peerId
    })

    if(process.env.VERBOSE) {
      console.log('CollateralInfo._loadCollateralInfo: Info loaded.');
    }

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
