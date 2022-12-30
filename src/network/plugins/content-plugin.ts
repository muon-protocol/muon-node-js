import BaseNetworkPlugin from './base/base-network-plugin.js';
import Content from '../../common/db-models/Content.js'
import CollateralInfoPlugin from "./collateral-info.js";
import {loadCID} from '../../utils/cid.js'
import {timeout} from '../../utils/helpers.js'
import all from 'it-all'
import Log from '../../common/muon-log.js'
import {Libp2pPeerInfo} from "../types";
import {peerId2Str} from "../utils.js";

const log = Log('muon:network:plugins:content')

export default class NetworkContentPlugin extends BaseNetworkPlugin {

  async onStart(){
    await super.onStart()

    let onlinePeers = this.collateralPlugin.onlinePeers
    if(onlinePeers.length > 0){
      this.provideContents()
    }
    else{
      // @ts-ignore
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
    let providers: Libp2pPeerInfo[] = await all(this.network.libp2p.contentRouting.findProviders(loadCID(cid), {timeout: 5000}))
    // @ts-ignore
    return providers.map(p => peerId2Str(p.id))
  }
}
