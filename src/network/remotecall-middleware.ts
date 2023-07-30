import {MuonNodeInfo} from "../common/types";
import BaseNetworkPlugin from "./plugins/base/base-network-plugin.js";
import * as CoreIpc from "../core/ipc.js"
import {Network} from "./index.js";

export type RemoteCallMiddleware = (plugin, method, any: any, callerInfo:MuonNodeInfo) => any

export const isDeployer:RemoteCallMiddleware = async (plugin:BaseNetworkPlugin, method: string, args: any, callerInfo: MuonNodeInfo) => {
  if(!callerInfo.isDeployer)
    throw `remote node is not deployer`;
}

export const ifSynced:RemoteCallMiddleware = async (network:Network, args: any, callerInfo) => {
  const dbIsSynced = await CoreIpc.isDbSynced();
  if(!dbIsSynced)
    throw `node context not synced yet`;
}
