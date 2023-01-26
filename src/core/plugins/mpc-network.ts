import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators.js";
import CallablePlugin from "./base/callable-plugin.js";
import {IMpcNetwork, PartnerRoundReceive} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base.js";
import {DistKey, DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import CollateralInfoPlugin from "./collateral-info.js";
import DistributedKey from "../../utils/tss/distributed-key.js";
import * as NetworkIpc from '../../network/ipc.js'
import TssPlugin from "./tss-plugin.js";
import * as SharedMemory from "../../common/shared-memory/index.js";
import {bn2hex} from "../../utils/tss/utils.js";

const RemoteMethods = {
  AskRoundN: 'ask-round-n'
}

const random = () => Math.floor(Math.random()*9999999)

@remoteApp
class MpcNetworkPlugin extends CallablePlugin implements IMpcNetwork{
  APP_NAME="mpcnet"
  private mpcMap: Map<string, MultiPartyComputation> = new Map<string, MultiPartyComputation>()
  // public readonly id: string;

  constructor(muon, configs) {
    super(muon, configs);
  }

  get id() {
    return this.collateralPlugin.currentNodeInfo!.id;
  }

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  private get tssPlugin(): TssPlugin {
    return this.muon.getPlugin('tss-plugin');
  }

  async registerMcp(mpc: MultiPartyComputation) {
    if(this.mpcMap.has(mpc.id))
      throw `MPC[${mpc.id}] already registered to MPCNetwork`
    this.mpcMap.set(mpc.id, mpc);

    // console.log({mpcId: mpc.id, pid: process.pid})
    let assignResponse = await NetworkIpc.assignTask(mpc.id);
    if(assignResponse !== 'Ok')
      throw "Cannot assign DKG task to itself."
  }

  async askRoundData(fromPartner: string, mpcId: string, round:number, data: any): Promise<PartnerRoundReceive> {
    let nodeInfo = this.collateralPlugin.getNodeInfo(fromPartner)!
    if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS) {
      return this.__askRoundN({mpcId, round, data}, this.collateralPlugin.currentNodeInfo)
    }
    else {
      return this.remoteCall(
        nodeInfo.peerId,
        RemoteMethods.AskRoundN,
        {mpcId, round, data},
        {taskId: mpcId, timeout: 30000}
      )
    }
  }

  waitToMpcFulFill(mpcId): Promise<any> {
    const mpc: MultiPartyComputation = this.mpcMap.get(mpcId)!
    if(!mpc)
      return Promise.reject(`MultiPartyComputation [${mpcId}] not found`)
    return mpc.waitToFulfill()
  }

  @remoteMethod(RemoteMethods.AskRoundN)
  async __askRoundN(message, callerInfo): Promise<PartnerRoundReceive> {
    const {mpcId, round, data} = message;
    if(round === 0) {
      if(!this.mpcMap.has(mpcId)) {
        // @ts-ignore
        let mpc = new DistributedKeyGeneration(...data.constructData)

        // console.log(`key generation start`, data.constructData)
        mpc.runByNetwork(this)
          .then(async (dKey: DistKey) => {
            if(mpc.extraParams.lowerThanHalfN && dKey.publicKeyLargerThanHalfN())
              return;

            const party = this.tssPlugin.getParty(mpc.extraParams.party);
            if(!party) {
              console.log(`part not found ${mpc.extraParams.party}`)
              throw `party[${mpc.extraParams.party}] not found`
            }

            let key = DistributedKey.load(party, {
              id: mpc.extraParams.keyId,
              share: bn2hex(dKey.share),
              publicKey: dKey.publicKey,
              partners: mpc.partners
            })
            // console.log(`new distributed key`, key.toSerializable());
            await SharedMemory.set(mpc.extraParams.keyId, key.toSerializable(), 30*60*1000)
          })
          .catch(e => {
            // TODO
          })
      }
    }
    const mpc = this.mpcMap.get(mpcId);
    if(!mpc)
      throw `pid: [${process.pid}] MPC [${mpcId}] not registered in MPCNetwork`
    return await mpc.getPartnerRoundData(round, callerInfo.id);
  }

  @gatewayMethod('test')
  async __testMpc() {
    const privateKeyToShare = '0x0000000000000000000000000000000000000000000000000000000000000001'
    /** DistributedKeyGen construction data */
    const cData = {
        id: `dkg-${Date.now()}${random()}`,
        partners: ['1', '2', '3'],
        t: 2,
        pk: privateKeyToShare
      };
    /** Generate random key */
    // const mpc = new DistributedKeyGeneration(cData.id, cData.partners, cData.t);
    /** Share PK between parties */
    const mpc = new DistributedKeyGeneration(
      cData.id,
      this.collateralPlugin.currentNodeInfo!.id,
      cData.partners,
      cData.t,
      cData.pk,
      {party: this.tssPlugin.tssParty!.id}
    );

    let result = await mpc.runByNetwork(this);
    console.log(result.toJson());
    return result.toJson();
  }
}

export default MpcNetworkPlugin;
