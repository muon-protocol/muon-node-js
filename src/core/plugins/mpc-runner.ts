import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators.js";
import CallablePlugin from "./base/callable-plugin.js";
import {MPCConstructData} from "../../common/mpc/types";
import {MultiPartyComputation} from "../../common/mpc/base.js";
import {DistributedKeyGeneration} from "../../common/mpc/dkg.js";
import CollateralInfoPlugin from "./collateral-info.js";

const RemoteMethods = {
  RunRoundN: 'run-round-n'
}

@remoteApp
class MpcRunner extends CallablePlugin {
  APP_NAME="mpc"
  private allMpcs = {}

  private get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  async process(mpc: MultiPartyComputation, constructData: MPCConstructData) {
    if(this.allMpcs[mpc.id])
      throw `MPC already proceed`;
    this.allMpcs[mpc.id] = mpc;
    const currentNode = this.collateralPlugin.currentNodeInfo!
    let store = {}, prevRound
    try {
      for (let r = 0; r < mpc.rounds.length; r++) {
        const round = mpc.rounds[r]
        // const {store, send, broadcast} = await mpc[round]()
        const allMpcPartners = this.collateralPlugin.filterNodes({
          list: mpc.partners
        });
        let allPartiesResult = await Promise.all(allMpcPartners.map(node => {
          if (node.id === currentNode.id) {
            return this.__runRoundN({round}, null)
          }
          else {
            return this.remoteCall(
              node.peerId,
              RemoteMethods.RunRoundN,
              {
                round
              }
            )
              .catch(e => {
                console.log(">>>>>", e)
                return "error"
              })
          }
        }))
        console.log({allPartiesResult})
        // mpc.addToStore(round, store)
      }
    }catch (e) {
      console.log(e);
    }

    return "test done"
  }

  @remoteMethod(RemoteMethods.RunRoundN)
  async __runRoundN(data, callerInfo) {
    console.log(`============= calling round ${data.round} ==============`);
    return 'OK'
  }

  // @gatewayMethod('test')
  // async __testMpc() {
  //   const mpc = new DistributedKeyGeneration('0', ['1', '2'], 2);
  //   let result = await this.process(mpc, {id: "sample-id", partners: ['1', '2'], params: [2]});
  //   console.log(result);
  //   return result;
  // }
}

export default MpcRunner;
