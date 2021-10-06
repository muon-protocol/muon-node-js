const BasePlugin = require('./base/base-plugin')

class CollateralInfoPlugin extends BasePlugin{

  // TODO: not implemented
  getWallets(){
    return this.muon.configs.net.collateralWallets;
  }
}

module.exports = CollateralInfoPlugin;
