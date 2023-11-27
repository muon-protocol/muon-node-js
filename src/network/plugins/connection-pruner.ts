import BaseNetworkPlugin from './base/base-network-plugin.js';
import {logger} from '@libp2p/logger'
import { timeout } from '../../utils/helpers.js';
import { ConnectionManagerConfigs, MuonNodeInfo } from '../../common/types.js';
import * as CoreIpc from '../../core/ipc.js'
import NodeManagerPlugin from './node-manager.js';
import { MapOf } from '../../common/mpc/types.js';
import lodash from "lodash"

const log = logger("muon:network:plugins:conn-pruner")


export default class LatencyCheckPlugin extends BaseNetworkPlugin {

  async onStart() {
    await super.onStart();

    this.watchAndPrune().catch(e => {});
  }

  private get nodeManager():NodeManagerPlugin {
    return this.network.getPlugin('node-manager');
  }

  async watchAndPrune() {
    const {libp2p} = this.network;
    const configs:ConnectionManagerConfigs = this.netConfigs.connectionManager;

    while(true) {
        await timeout(configs.pruneInterval);

        const connections = libp2p.components.connectionManager.getConnections();
        log(`check connections ...`, {count: connections.length, maxConnections: configs.maxConnections})
        if(connections.length > configs.maxConnections) {
            /** prunning connections */

            const withCommonSubnet:string[] = await CoreIpc.GetNodesWithCommonSubnet();
            const isInCommonSubnet:MapOf<boolean> = this.nodeManager.filterNodes({list: withCommonSubnet})
                .map(n => n.peerId)
                .reduce((obj, curr) => (obj[curr]=true, obj), {});
            const allNodes:MapOf<MuonNodeInfo> = this.nodeManager.filterNodes({
                list: lodash.uniq(
                    lodash.flatten([
                        connections.map(c => `${c.remotePeer}`),
                        withCommonSubnet,
                    ])
                )
            })
                .reduce((obj, curr) => (obj[curr.peerId]=curr, obj), {});

            /** sort connections */
            const sorted = connections.sort((a, b) => {
                /** rank connection a */
                const nodeA = allNodes[a.remotePeer];
                const aRank = (nodeA.isDeployer ? 4 : 0) 
                    + (isInCommonSubnet[nodeA.peerId] ? 2 : 0)
                    + (a.timeline.upgraded > b.timeline.upgraded ? 1 : -1)

                /** rank connection b */
                const nodeB = allNodes[b.remotePeer];
                const bRank = (nodeB.isDeployer ? 4 : 0) 
                    + (isInCommonSubnet[nodeB.peerId] ? 2 : 0)
                    + (b.timeline.upgraded > a.timeline.upgraded ? 1 : -1)

                return aRank - bRank;
            })
            const numToPrune = connections.length - configs.maxConnections;

            const connToPrune = sorted.slice(0, numToPrune);
            log(`prunning connections: %o`, connToPrune.map(c => allNodes[`${c.remotePeer}`].id));
            await Promise.all(
                connToPrune.map(conn => {
                    return libp2p.hangUp(conn.remotePeer)
                        .catch(e => log.error(`error when pruning connection %s`, e.message));
                })
            )
        }
    }
  }
}
