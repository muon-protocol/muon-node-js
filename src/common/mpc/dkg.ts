import {MapOf, RoundOutput, RoundProcessor} from "./types";
import {MultiPartyComputation} from "./base";
import {bn2str} from './utils'
import Web3 from 'web3'
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
type Round2Broadcast = {
  commitmentHashes: MapOf<string>
}

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
    let fx = new Polynomial(this.t, TssModule.curve, this.value ? TssModule.toBN(this.value) : undefined);
    let hx = new Polynomial(this.t, TssModule.curve);

    const Fx = fx.coefPubKeys();
    const Hx = hx.coefPubKeys(TssModule.H)
    const commitment = Fx.map((Fxi, i) => TssModule.pointAdd(Fxi, Hx[i]))

    const store = {fx, hx, Fx, Hx, commitment}
    const send = {}
    const broadcast= {
      commitment: commitment.map(pubKey => pubKey.encode('hex', true))
    }
    return {store, send, broadcast}
  }

  round2(prevStepOutput: MapOf<Round1Result>, preStepBroadcast: MapOf<Round1Broadcast>): RoundOutput<Round2Result, Round2Broadcast> {
    const store = {}
    const send = {}
    const broadcast= {
      commitmentHashes: {}
    }

    this.partners.forEach(id => {
      send[id] = {
        Fx: this.store[0].Fx.map(pubKey => pubKey.encode('hex', true)),
        Hx: this.store[0].Hx.map(pubKey => pubKey.encode('hex', true)),
        f: bn2str(this.store[0].fx.calc(id)),
        h: bn2str(this.store[0].hx.calc(id)),
      }
      const commitments = preStepBroadcast[id].commitment.map(v => ({t: 'bytes', v}))
      broadcast.commitmentHashes[id] = Web3.utils.soliditySha3(...commitments)
    })

    return {store, send, broadcast}
  }

  finalize(roundArrivedMessages, networkId): string {
    const firstRoundMessages = roundArrivedMessages[0],
      secondRoundMessages = roundArrivedMessages[1]

    /** Check pedersen commitment */
    this.partners.forEach(fromIndex => {
      if(fromIndex !== networkId) {
        /** check each node's commitments sent to all nodes are the same. */
        const commToCurrent = secondRoundMessages[networkId].broadcast.commitmentHashes[fromIndex]
        this.partners.forEach(toNode => {
          const commToOther = secondRoundMessages[toNode].broadcast.commitmentHashes[fromIndex]
          if(commToCurrent !== commToOther)
            throw `Commitment sent to different node[${toNode}] mismatched.`
        })

        /** check each node's commitments is correct. */
        let {f, h} = secondRoundMessages[fromIndex].send
        f = TssModule.toBN(f)
        h = TssModule.toBN(h)
        const commitment = firstRoundMessages[fromIndex].broadcast.commitment
          .map(pubKeyStr => TssModule.keyFromPublic(pubKeyStr))
        let p1 = TssModule.calcPolyPoint(networkId, commitment)
        let p2 = TssModule.pointAdd(TssModule.curve.g.mul(f), TssModule.H.mul(h));
        if(!p1.eq(p2)) {
          throw `DistributedKey partial data verification failed from partner ${fromIndex}.`
        }
      }
    })

    /** share calculation */
    let share = Object.keys(secondRoundMessages)
      .map(from => secondRoundMessages[from].send.f)
      .reduce((acc, current) => {
        acc.iadd(TssModule.toBN(current))
        return acc
      }, TssModule.toBN('0'))
    share.imul(TssModule.toBN(this.partners.length.toString()).invm(TssModule.curve.n))
    return bn2str(share.umod(TssModule.curve.n))
  }
}
