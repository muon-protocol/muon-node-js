import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators.js";
import CallablePlugin from "./base/callable-plugin.js";
import {IMpcNetwork, MapOf, PartnerRoundReceive} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base.js";
import NodeManagerPlugin from "./node-manager.js";
import * as NetworkIpc from '../../network/ipc.js'
import NodeCache from 'node-cache'
import {logger} from '@libp2p/logger'
import {MpcInitHandler, MpcType, PartyInfo} from "../../common/types";

const log = logger("muon:core:plugins:mpc:network")

const mpcCache = new NodeCache({
  stdTTL: 10 * 60, // Keep MPCs in memory for 10 minutes
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 5*60,
  useClones: false,
});

const RemoteMethods = {
  AskRoundN: 'ask-round-n'
}

@remoteApp
class MpcNetworkPlugin extends CallablePlugin implements IMpcNetwork{
  APP_NAME="mpcnet"
  private mpcInitializeHandlers: MapOf<MpcInitHandler> = {}
  // public readonly id: string;

  constructor(muon, configs) {
    super(muon, configs);
  }

  get id() {
    return this.nodeManager.currentNodeInfo!.id;
  }

  private get nodeManager(): NodeManagerPlugin {
    return this.muon.getPlugin('node-manager');
  }

  async registerMpc(mpc: MultiPartyComputation) {
    if(mpcCache.has(mpc.id))
      throw `MPC[${mpc.id}] already registered to MPCNetwork`
    mpcCache.set(mpc.id, mpc);

    // console.log({mpcId: mpc.id, pid: process.pid})
    let assignResponse = await NetworkIpc.assignTask(mpc.id);
    if(assignResponse !== 'Ok')
      throw "Cannot assign DKG task to itself."
  }

  async askRoundData(fromPartner: string, mpcId: string, round:number, data: any): Promise<PartnerRoundReceive> {
    let nodeInfo = this.nodeManager.getNodeInfo(fromPartner)!
    if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS) {
      return this.__askRoundN({mpcId, round, data}, this.nodeManager.currentNodeInfo)
    }
    else {
      return this.remoteCall(
        nodeInfo.peerId,
        RemoteMethods.AskRoundN,
        {mpcId, round, data},
        {taskId: mpcId, timeout: 20e3}
      )
    }
  }

  waitToMpcFulFill(mpcId): Promise<any> {
    const mpc: MultiPartyComputation = mpcCache.get(mpcId)!
    if(!mpc)
      return Promise.reject(`MultiPartyComputation [${mpcId}] not found`)
    return mpc.waitToFulfill()
  }

  registerMpcInitHandler(mpcType: MpcType, handler:MpcInitHandler) {
    if(!!this.mpcInitializeHandlers[mpcType])
      throw `Only one MPC initializer most be registered`;
    this.mpcInitializeHandlers[mpcType] = handler;
  }

  async callMpcInitHandler(mpcType: MpcType, constructData) {
    if(!this.mpcInitializeHandlers[mpcType])
      throw `MPC initializer not registered`;
    return this.mpcInitializeHandlers[mpcType](constructData, this);
  }

  @remoteMethod(RemoteMethods.AskRoundN)
  async __askRoundN(message, callerInfo): Promise<PartnerRoundReceive> {
    const {mpcId, round, data} = message;
    if(round === 0) {
      if(!mpcCache.has(mpcId)) {
        const {constructData, constructData: {extra}} = data;
        await this.callMpcInitHandler(extra.mpcType, constructData);
      }
    }
    const mpc: MultiPartyComputation = mpcCache.get(mpcId)!;
    if(!mpc)
      throw `pid: [${process.pid}] MPC [${mpcId}] not registered in MPCNetwork`
    return await mpc.getPartnerRoundData(round, callerInfo.id);
  }
}

export default MpcNetworkPlugin;
