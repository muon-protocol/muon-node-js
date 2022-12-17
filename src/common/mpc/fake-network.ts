import QueueProducer from "../message-bus/queue-producer";
import QueueConsumer from "../message-bus/queue-consumer";
import {MapOf} from "./types";
import {MultiPartyComputation} from "./base";

export default class FakeNetwork {
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
    // console.log(`ID[${this.id}].__onMessageArrive`)
    // console.dir(arguments, {depth: null})
    const {mpcId, round, data} = message;
    const mpc = this.mpcMap.get(mpcId);
    if(!mpc)
      throw `MPC [${mpcId}] not registered in MPCNetwork`
    await mpc.onMessageArrive(round, data, this.id);
  }

  async send(toPartner: string, mpcId: string, round:number, data: any) {
    if(!this.sendBus[toPartner]) {
      this.sendBus[toPartner] = new QueueProducer<any>(this.getBusBaseName(toPartner))
    }
    return await this.sendBus[toPartner].send({mpcId, round, data});
  }

  async receive() {
  }
}
