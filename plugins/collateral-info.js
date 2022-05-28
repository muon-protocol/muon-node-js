const BasePlugin = require('./base/base-plugin')

class CollateralInfoPlugin extends BasePlugin{

  peersWallet = {}
  walletsPeer = {}

  constructor(muon, configs) {
    super(muon, configs);

    let {collateralWallets} = muon.configs.net;

    let parts = collateralWallets.map(cw => cw.split('@'))

    if(parts.findIndex(p => p.length !== 2) >= 0) {
      throw "Invalid collateral wallet config located at config/global/net.conf.json"
    }

    parts.forEach(([wallet, peerId]) => {
      this.peersWallet[peerId] = wallet
      this.walletsPeer[wallet] = peerId
    })
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
}

module.exports = CollateralInfoPlugin;
