import {MuonNodeInfo} from "../common/types";
import Muon from "./muon.js";

export type CoreRemoteCallMiddleware = (plugin, method, any: any, callerInfo:MuonNodeInfo) => any

export const isDeployer:CoreRemoteCallMiddleware = async (muon: Muon, args: any, callerInfo: MuonNodeInfo) => {
  if(!callerInfo.isDeployer)
    throw `remote node is not deployer`;
}

export const validateInput: CoreRemoteCallMiddleware = async (muon: Muon, args: any, callerInfo: MuonNodeInfo) => {
}
