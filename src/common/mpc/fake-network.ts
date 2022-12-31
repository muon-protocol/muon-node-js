import QueueProducer from "../message-bus/queue-producer.js";
import QueueConsumer from "../message-bus/queue-consumer.js";
import {IMpcNetwork, MapOf} from "./types.js";
import {MultiPartyComputation} from "./base.js";

export default class FakeNetwork implements IMpcNetwork{
  readonly id: string;
  private sendBus: MapOf<QueueProducer<any>> = {};
  private readonly receiveBus: QueueConsumer<any>;
  private mpcMap: Map<string, MultiPartyComputation> = new Map<string, MultiPartyComputation>();

  constructor(id: string) {
    this.id = id;

    const bus = new QueueConsumer(this.getBusBaseName(id))
    bus.on("message", this.__onMessageArrive.bind(this))
    this.receiveBus = bus;
  }

  registerMcp(mpc: MultiPartyComputation) {
    if(this.mpcMap.has(mpc.id))
      throw `MPC[${mpc.id}] already registered to MPCNetwork`
    this.mpcMap.set(mpc.id, mpc);
  }

  private getBusBaseName(id) {
    return `fake-network-${id}`
  }

  private async __onMessageArrive(message) {
    const {mpcId, round, forPartner, data} = message;
    const mpc = this.mpcMap.get(mpcId);
    if(!mpc)
      throw `MPC [${mpcId}] not registered in MPCNetwork`
    return await mpc.getPartnerRoundData(round, forPartner);
  }

  async askRoundData(from: string, mpcId: string, round: number, data: any) {
    if(!this.sendBus[from]) {
      this.sendBus[from] = new QueueProducer<any>(this.getBusBaseName(from))
    }
    return await this.sendBus[from].send({mpcId, round, forPartner: this.id, data});
  }

}
