const BasePlugin = require('./base/base-plugin')

class CollateralInfoPlugin extends BasePlugin{

  wallets = []
  peersWallet = {}

  constructor(muon, configs) {
    super(muon, configs);

    let {collateralWallets} = muon.configs.net;

    let parts = collateralWallets.map(cw => cw.split('@'))

    if(parts.findIndex(p => p.length !== 2) >= 0) {
      throw "Invalid collateral wallet config located at config/global/net.conf.json"
    }

    this.wallets = parts.map(p => p[0])
    this.peersWallet = parts.reduce((obj, [wallet, peerId]) => {
      obj[peerId] = wallet;
      return obj;
    }, {})
  }

  // TODO: not implemented
  getWallets(){
    return this.wallets;
  }

  getPeerWallet(peerId) {
    return this.peersWallet[peerId.toB58String()];
  }
}

module.exports = CollateralInfoPlugin;
