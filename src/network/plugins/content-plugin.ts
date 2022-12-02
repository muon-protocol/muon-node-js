import BaseNetworkPlugin from './base/base-network-plugin';
const Content = require('../../common/db-models/Content')
import CollateralInfoPlugin from "./collateral-info";
const {loadCID} = require('../../utils/cid')
const {timeout} = require('../../utils/helpers')
const all = require('it-all')
const log = require('../../common/muon-log')('muon:network:plugins:content')

export default class NetworkContentPlugin extends BaseNetworkPlugin {

  async onStart(){
    await super.onStart()

    let onlinePeers = this.collateralPlugin.onlinePeers
    if(onlinePeers.length > 0){
      this.provideContents()
    }
    else{
      this.network.once('peer:connect', () => {
        this.provideContents();
      })
    }
  }

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.network.getPlugin('collateral');
  }

  async provideContents() {
    /** wait to DHT load peer info */
    await timeout(50000);

    try {
      let contents = await Content.find({});
      let cidList = contents.map(c => c.cid)
      await this.provide(cidList);
    }catch (e) {
      console.error("ERROR: network.ContentPlugin.provideContents", e)
    }
  }

  async provide(cids: string | string[]) {
    if(!Array.isArray(cids))
      cids = [cids]
    for (let cid of cids) {
      log(`providing content ${cid}`)
      await this.network.libp2p.contentRouting.provide(loadCID(cid));
    }
  }

  async find(cid: string) {
    log(`Finding content ...`, cid);
    let providers = await all(this.network.libp2p.contentRouting.findProviders(loadCID(cid), {timeout: 5000}))
    return providers.map(p => p.id._idB58String)
  }
}
