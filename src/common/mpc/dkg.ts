import {MapOf, MultiPartyComputation, RoundOutput, RoundProcessor} from "./base";
import {bn2str} from './utils'
import DistributedKey from "../../utils/tss/distributed-key";
import Polynomial from "../../utils/tss/polynomial";
import * as TssModule from "../../utils/tss";
import {PublicKey} from "../../utils/tss/types";
import BN from 'bn.js';

type Round1Result = any
type Round1Broadcast = {
  commitment: string[]
}

type Round2Result = {
  Fx: string[],
  Hx: string[],
  share: string
}
type Round2Broadcast = any

export class DistributedKeyGeneration extends MultiPartyComputation {

  private readonly t: number;
  private readonly value: BN | undefined;

  constructor(id: string, partners: string[], t: number, value?:BN) {
    super(id, partners, ['round1', 'round2']);
    // console.log(`${this.ConstructorName} construct with`, {id, partners, t, value});

    this.t = t
    this.value = value
  }

  round1(): RoundOutput<Round1Result, Round1Broadcast> {
    // console.log(`round1 call.`)
    let fx = new Polynomial(this.t, TssModule.curve, this.value ? TssModule.toBN(this.value) : undefined);
    let hx = new Polynomial(this.t, TssModule.curve);

    const Fx = fx.coefPubKeys();
    const Hx = hx.coefPubKeys();
    const commitment = Fx.map((Fxi, i) => TssModule.pointAdd(Fxi, Hx[i]))

    const store = {fx, hx, Fx, Hx, commitment}
    const send = {}
    const broadcast= {
      commitment: commitment.map(pubKey => pubKey.encode('hex', true))
    }
    // console.log(`round1 output`, {store, send, broadcast})
    return {store, send, broadcast}
  }

  round2(prevStepOutput: MapOf<Round1Result>, preStepBroadcast: MapOf<Round1Broadcast>): RoundOutput<Round2Result, Round2Broadcast> {
    // console.log(`round2 call`, {prevStepOutput, preStepBroadcast})
    const store = {}
    const send = {}
    const broadcast= null

    this.partners.forEach(id => {
      send[id] = {
        Fx: this.store[0].Fx.map(pubKey => pubKey.encode('hex', true)),
        Hx: this.store[0].Hx.map(pubKey => pubKey.encode('hex', true)),
        share: bn2str(this.store[0].fx.calc(id))
      }
    })

    // console.log(`round2 output`, {store, send, broadcast})
    return {store, send, broadcast}
  }

  finalize(roundArrivedMessages): string {
    const finalRoundMessages = roundArrivedMessages[1]
    // console.log('final round receives', finalRoundMessages)
    let share = Object.keys(finalRoundMessages)
      .map(from => finalRoundMessages[from].send.share)
      .reduce((acc, current) => {
        acc.iadd(TssModule.toBN(current))
        return acc
      }, TssModule.toBN('0'))
    share.imul(TssModule.toBN(this.partners.length.toString()).invm(TssModule.curve.n))
    return bn2str(share.umod(TssModule.curve.n))
  }
}
