import BaseNetworkPlugin from './base/base-network-plugin.js';
import {logger} from '@libp2p/logger'
import { timeout } from '../../utils/helpers.js';
import { ConnectionManagerConfigs, MuonNodeInfo } from '../../common/types.js';
import * as CoreIpc from '../../core/ipc.js'
import NodeManagerPlugin from './node-manager.js';
import { MapOf } from '../../common/mpc/types.js';
import lodash from "lodash"
import RemoteCall from './remote-call.js';

const log = logger("muon:network:plugins:conn-pruner")


export default class LatencyCheckPlugin extends BaseNetworkPlugin {

  async onStart() {
    await super.onStart();

    this.watchAndPrune().catch(e => {});
  }

  private get nodeManager():NodeManagerPlugin {
    return this.network.getPlugin('node-manager');
  }

  private get remoteCallPlugin(): RemoteCall {
    return this.network.getPlugin('remote-call');
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

            const lastCallTimes:MapOf<number> = this.remoteCallPlugin.getLastCallTimes();

            /** sort connections */
            const sorted = connections.sort((a, b) => {
                a = `${a.remotePeer}`;
                b = `${b.remotePeer}`;
                /** rank connection a */
                const nodeA = allNodes[a];
                const aRank = (isInCommonSubnet[a] ? 4 : 0)
                    + (nodeA.isDeployer ? 2 : 0)
                    + (lastCallTimes[a] > lastCallTimes[b] ? 1 : -1)

                /** rank connection b */
                const nodeB = allNodes[b];
                const bRank = (isInCommonSubnet[b] ? 4 : 0) 
                    + (nodeB.isDeployer ? 2 : 0)
                    + (lastCallTimes[b] > lastCallTimes[a] ? 1 : -1)

                return aRank - bRank;
            })
            const numToPrune = configs.pruneBatchSize;

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
