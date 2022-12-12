import {gatewayMethod, remoteApp, remoteMethod} from "./base/app-decorators";
import CallablePlugin from "./base/callable-plugin";
import {MultiPartyComputation} from "../../common/mpc/base";
import {DistributedKeyGeneration} from "../../common/mpc/dkg";

@remoteApp
class MpcRunner extends CallablePlugin {
  APP_NAME="explorer"

  async process(mpc: MultiPartyComputation) {
    let store = {}, prevRound
    for(let r=0 ; r < mpc.rounds.length ; r++) {
      const round = mpc.rounds[r]
      const result = await mpc[round]()
    }
  }

  @remoteMethod('sun-step')
  async __runStepN(data, callerInfo) {
  }

  @gatewayMethod('test')
  async __testMpc() {
    const mpc = new DistributedKeyGeneration('0', ['1', '2'], 2);
    let result = await this.process(mpc);
    console.log(result);
    return result;
  }
}

export default MpcRunner;
