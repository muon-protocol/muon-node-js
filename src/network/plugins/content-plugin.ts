import BaseNetworkPlugin from './base/base-network-plugin.js';
import CollateralInfoPlugin from "./collateral-info.js";
import {loadCID} from '../../utils/cid.js'
import all from 'it-all'
import Log from '../../common/muon-log.js'
import {Libp2pPeerInfo} from "../types";
import {peerId2Str} from "../utils.js";

const log = Log('muon:network:plugins:content')

export default class NetworkContentPlugin extends BaseNetworkPlugin {

  async onStart(){
    await super.onStart()
  }

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.network.getPlugin('collateral');
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
