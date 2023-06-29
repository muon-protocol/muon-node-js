import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators.js";
import CallablePlugin from "./base/callable-plugin.js";
import {IMpcNetwork, PartnerRoundReceive} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base.js";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import {DistKey} from '../../common/mpc/dist-key.js'
import NodeManagerPlugin from "./node-manager.js";
import AppTssKey from "../../utils/tss/app-tss-key.js";
import * as NetworkIpc from '../../network/ipc.js'
import KeyManager from "./key-manager.js";
import * as SharedMemory from "../../common/shared-memory/index.js";
import {bn2hex} from "../../utils/tss/utils.js";
import NodeCache from 'node-cache'
import {logger} from '@libp2p/logger'
import {PartyInfo} from "../../common/types";

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

const random = () => Math.floor(Math.random()*9999999)

@remoteApp
class MpcNetworkPlugin extends CallablePlugin implements IMpcNetwork{
  APP_NAME="mpcnet"
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

  private get keyManager(): KeyManager {
    return this.muon.getPlugin('key-manager');
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
        {taskId: mpcId, timeout: 15e3}
      )
    }
  }

  waitToMpcFulFill(mpcId): Promise<any> {
    const mpc: MultiPartyComputation = mpcCache.get(mpcId)!
    if(!mpc)
      return Promise.reject(`MultiPartyComputation [${mpcId}] not found`)
    return mpc.waitToFulfill()
  }

  @remoteMethod(RemoteMethods.AskRoundN)
  async __askRoundN(message, callerInfo): Promise<PartnerRoundReceive> {
    const {mpcId, round, data} = message;
    if(round === 0) {
      if(!mpcCache.has(mpcId)) {
        // @ts-ignore
        let mpc = new DistributedKeyGeneration(...data.constructData)

        // console.log(`key generation start`, data.constructData)
        mpc.runByNetwork(this)
          .then(async (dKey: DistKey) => {
            if(mpc.extraParams.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
              return;

            const partyInfo: PartyInfo = mpc.extraParams.partyInfo as PartyInfo
            const party = await this.keyManager.getAppPartyAsync(partyInfo.appId, partyInfo.seed, partyInfo.isForReshare);
            if(!party) {
              throw `party[${mpc.extraParams.party}] not found`
            }

            let key = new AppTssKey(party, mpc.extraParams.keyId, dKey)
            await SharedMemory.set(mpc.extraParams.keyId, {partyInfo, key: key.toJson()}, 30*60*1000)
          })
          .catch(e => {
            // TODO
            log.error("MpcNetwork running mpc failed. %O", e)
          })
      }
    }
    const mpc: MultiPartyComputation = mpcCache.get(mpcId)!;
    if(!mpc)
      throw `pid: [${process.pid}] MPC [${mpcId}] not registered in MPCNetwork`
    return await mpc.getPartnerRoundData(round, callerInfo.id);
  }
}

export default MpcNetworkPlugin;
