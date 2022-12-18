import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators";
import CallablePlugin from "./base/callable-plugin";
import {IMpcNetwork} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base";
import {DistributedKeyGeneration} from "../../common/mpc/dkg";
import CollateralInfoPlugin from "./collateral-info";
const {timeout} = require('../../utils/helpers')

const RemoteMethods = {
  RunRoundN: 'run-round-n'
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

  registerMcp(mpc: MultiPartyComputation) {
    if(this.mpcMap.has(mpc.id))
      throw `MPC[${mpc.id}] already registered to MPCNetwork`
    this.mpcMap.set(mpc.id, mpc);
  }

  async send(toPartner: string, mpcId: string, round:number, data: any) {
    let nodeInfo = this.collateralPlugin.getNodeInfo(toPartner)!
    if(!nodeInfo.isOnline)
      throw `node [${nodeInfo.wallet}] is not online`
    if(nodeInfo.wallet === process.env.SIGN_WALLET_ADDRESS) {
      return this.__runRoundN({mpcId, round, data}, this.collateralPlugin.currentNodeInfo)
    }
    else {
      return this.remoteCall(
        nodeInfo.peerId,
        RemoteMethods.RunRoundN,
        {mpcId, round, data},
        // {taskId: `keygen-${nonce.id}`}
      )
    }
  }

  @remoteMethod(RemoteMethods.RunRoundN)
  async __runRoundN(message, callerInfo) {
    const {mpcId, round, data} = message;
    console.log(`============= calling round[${round}] from [${callerInfo.id}] ==============`);
    // await timeout(5000);
    // console.dir(message, {depth: null})
    if(round === 0) {
      if(!this.mpcMap.has(mpcId)) {
        // @ts-ignore
        let mpc = new DistributedKeyGeneration(...data.constructData)
        this.registerMcp(mpc);

        mpc.runByNetwork(this)
          .then(result => {
            console.log(result.toJson())
          })
          .catch(e => {
            // TODO
          })
      }
    }
    const mpc = this.mpcMap.get(mpcId);
    if(!mpc)
      throw `MPC [${mpcId}] not registered in MPCNetwork`
    await mpc.onMessageArrive(round, data, this.id);
    return 'OK'
  }

  @gatewayMethod('test')
  async __testMpc() {
    const privateKeyToShare = '0x0000000000000000000000000000000000000000000000000000000000000001'
    /** DistributedKeyGen construction data */
    const cData = {
        id: `dkg-${Date.now()}${random()}`,
        partners: ['1', '2'],
        t: 2,
        pk: privateKeyToShare
      }
    const mpc = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk);
    this.registerMcp(mpc);

    let result = await mpc.runByNetwork(this);
    console.log(result.toJson());
    return result.toJson();
  }
}

export default MpcNetworkPlugin;
