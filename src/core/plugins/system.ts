import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
const soliditySha3 = require('../../utils/soliditySha3');

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get CollateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  get TssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');;;;;
  }

  getAvailableNodes() {
    const peerIds = Object.keys(this.TssPlugin.availablePeers)
    return [
      process.env.SIGN_WALLET_ADDRESS,
      ...peerIds.map(peerId => this.CollateralPlugin.getPeerWallet(peerId))
    ]
  }

  selectRandomNodes(seed, n) {
    const availableNodes = this.getAvailableNodes();
    if(availableNodes.length < n)
      throw `No enough nodes to select n subset`
    let nodesHash = availableNodes.map(wallet => {
      return {
        wallet,
        hash: soliditySha3([
          {t: 'uint256', v: seed},
          {t: 'address', v: wallet},
        ])
      }
    })
    nodesHash.sort((a, b) => (a.hash > b.hash ? 1 : -1))
    return nodesHash.slice(0, n).map(i => i.wallet)
  }
}

export default System
