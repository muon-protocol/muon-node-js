import {MapOf, MultiPartyComputation, RoundOutput, RoundProcessor} from "./base";
import DistributedKey from "../../utils/tss/distributed-key";
import Polynomial from "../../utils/tss/polynomial";
import * as TssModule from "../../utils/tss";
import {PublicKey} from "../../utils/tss/types";
import BN from 'bn.js';

type Round1Result = any
type Round1Broadcast = {
  Fx: string[],
  Hx: string[],
  commitment: string[]
}

type Round2Result = {
  share: string
}
type Round2Broadcast = any

export class DistributedKeyGeneration extends MultiPartyComputation {

  private fx: Polynomial;
  private hx: Polynomial;
  private commitment: PublicKey[] = [];
  private readonly t: number;
  private readonly value: BN | undefined;

  constructor(id: string, partners: string[], t: number, value?:BN) {
    super(id, partners, ['round1', 'round2']);

    this.t = t
    this.value = value
  }

  round1(): RoundOutput<Round1Result, Round1Broadcast> {
    let fx = new Polynomial(this.t, TssModule.curve, this.value);
    let hx = new Polynomial(this.t, TssModule.curve);
    this.f_x = fx
    this.h_x = hx

    const Fx = fx.coefPubKeys().map(pubKey => pubKey.encode('hex', true));
    const Hx = hx.coefPubKeys().map(pubKey => pubKey.encode('hex', true));
    const commitment = Fx.map((Fxi, i) => TssModule.pointAdd(Fxi, Hx[i]).encode('hex', true))

    const output = {},
      broadcast= {
        Fx,
        Hx,
        commitment
      }

    return {output, broadcast}
  }

  round2(prevStepOutput: MapOf<Round1Result>, preStepBroadcast: MapOf<Round1Broadcast>): RoundOutput<Round2Result, Round2Broadcast> {
    const output = {}
    const broadcast= null

    this.partners.forEach(id => {
      this.output[id] = {share: this.fx.calc(id)}
    })

    return {output, broadcast}
  }
}
