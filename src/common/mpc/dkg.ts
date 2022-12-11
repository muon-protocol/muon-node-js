import {MultiPartyComputation, RoundBroadcastIn, RoundOutput, RoundProcessor, RoundResultIn} from "./base";
import DistributedKey from "../../utils/tss/distributed-key";

type KeyGenResult = {}
type KeyGenBroadcast = {}

export class DistributedKeyGeneration extends MultiPartyComputation {

  private key: DistributedKey

  constructor(partners: string[]) {
    super(partners, ['step1', 'step2']);
  }

  step1(): RoundOutput {
    this.key = new DistributedKey(null, "test", 3000)
    const output = {
        // for each partners: share public key
      },
      broadcast= {
        commitment: []
      }

    return {output, broadcast}
  }

  step2(prevStepOutput: RoundResultIn, preStepBroadcast: RoundBroadcastIn): RoundOutput {
  }
}
