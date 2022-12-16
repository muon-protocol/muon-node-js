import QueueProducer from "../message-bus/queue-producer";
import QueueConsumer from "../message-bus/queue-consumer";
import {MapOf} from "./base";

const Events = require('events-async')

export default class FakeNetwork extends Events{
  readonly id: string;
  private sendBus: MapOf<QueueProducer<any>> = {};
  private readonly receiveBus: QueueConsumer<any>;

  constructor(id: string) {
    super()
    this.id = id;

    const bus = new QueueConsumer(this.getBusBaseName(id))
    bus.on("message", this.__onMessageArrive.bind(this))
    this.receiveBus = bus;
  }

  private getBusBaseName(id) {
    return `fake-network-${id}`
  }

  private async __onMessageArrive(message) {
    // console.log(`ID[${this.id}].__onMessageArrive`)
    // console.dir(arguments, {depth: null})
    const {round, data} = message;
    return await this.emit("message", round, data, this.id)
  }

  async send(to: string, round:number, data: any) {
    if(!this.sendBus[to]) {
      this.sendBus[to] = new QueueProducer<any>(this.getBusBaseName(to))
    }
    return await this.sendBus[to].send({round, data});
  }

  async receive() {
  }

  on() {
    super.on(...arguments)
  }
}
