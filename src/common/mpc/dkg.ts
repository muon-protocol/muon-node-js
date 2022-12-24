import {MapOf, RoundOutput, RoundProcessor} from "./types";
import {MultiPartyComputation} from "./base";
import {bn2str} from './utils'
import Web3 from 'web3'
import Polynomial from "../../utils/tss/polynomial";
import * as TssModule from "../../utils/tss";
import {PublicKey} from "../../utils/tss/types";
import BN from 'bn.js';

/**
 * Round0 input/output types
 */
type Round0Result = any;
type Round0Broadcast = {
  fxHash: string,
  hxHash: string,
}

/**
 * Round1 input/output types
 */
type Round1Result = any
type Round1Broadcast = {
  commitment: string[],
  allPartiesCommitmentHash: MapOf<string>
}

/**
 * Round2 input/output types
 */
type Round2Result = {
  Fx: string[],
  Hx: string[],
  share: string
}
type Round2Broadcast = {
  commitmentHashes: MapOf<string>
}

export class DistKey {
  index: string;
  share: BN;
  address: string;
  publicKey: PublicKey;
  curve: {
    t: number,
    Fx: PublicKey[]
  };

  constructor(index: string, share: BN, address: string, publicKey : PublicKey, curve: {t: number, Fx: PublicKey[]}) {
    this.index = index;
    this.share = share;
    this.address = address;
    this.publicKey = publicKey;
    this.curve = curve;
  }

  toJson() {
    return {
      index: this.index,
      share: bn2str(this.share),
      address: this.address,
      publicKey: this.publicKey.encode('hex', true),
      curve: {
        t: this.curve.t,
        Fx: this.curve.Fx.map(p => p.encode('hex', true))
      }
    }
  }

  static fromJson(key) {
    return new DistKey(
      key.index,
      TssModule.toBN(key.share),
      key.address,
      TssModule.keyFromPublic(key.publicKey),
      {
        t: key.curve.t,
        Fx: key.curve.Fx.map(p => TssModule.keyFromPublic(p))
      },
    );
  }
}

export class DistributedKeyGeneration extends MultiPartyComputation {

  private readonly t: number;
  private readonly value: BN | undefined;

  constructor(id: string, partners: string[], t: number, value?: BN|string, extra: object={}) {
    // @ts-ignore
    super(['round0', 'round1', 'round2'], ...Object.values(arguments));
    // console.log(`${this.ConstructorName} construct with`, {id, partners, t, value});

    this.t = t
    if(!!value) {
      if(BN.isBN(value))
        this.value = value
      else
        this.value = Web3.utils.toBN(value);
    }
  }

  round0(): RoundOutput<Round0Result, Round0Broadcast> {
    let fx = new Polynomial(this.t, TssModule.curve, this.value ? TssModule.toBN(this.value) : undefined);
    let hx = new Polynomial(this.t, TssModule.curve);

    const Fx = fx.coefPubKeys();
    const Hx = hx.coefPubKeys(TssModule.H)
    const commitment = Fx.map((Fxi, i) => TssModule.pointAdd(Fxi, Hx[i]))

    const store = {fx, hx, Fx, Hx, commitment}
    const send = {}
    const broadcast= {
      fxHash: Web3.utils.soliditySha3(
        ...Fx
          .map(pubKey => ({t: 'bytes', v: pubKey.encode('hex', true)}))
      )!,
      hxHash: Web3.utils.soliditySha3(
        ...Hx.map(pubKey => ({t: 'bytes', v: pubKey.encode('hex', true)}))
      )!,
    }
    return {store, send, broadcast}

  }

  round1(prevStepOutput: MapOf<Round0Result>, preStepBroadcast: MapOf<Round0Broadcast>): RoundOutput<Round1Result, Round1Broadcast> {
    const {commitment} = this.store['round0'];
    const r0Msgs = this.roundsArrivedMessages['round0']
    const allPartiesCommitmentHash = {}
    Object.keys(r0Msgs).forEach(from => {
      allPartiesCommitmentHash[from] = r0Msgs[from].broadcast
    })

    const store = {}
    const send = {}
    const broadcast= {
      commitment: commitment.map(pubKey => pubKey.encode('hex', true)),
      allPartiesCommitmentHash
    }
    return {store, send, broadcast}
  }

  round2(prevStepOutput: MapOf<Round1Result>, preStepBroadcast: MapOf<Round1Broadcast>): RoundOutput<Round2Result, Round2Broadcast> {
    /**
     * Check all partners broadcast same commitment to all other parties.
     */
    const allPartners = this.partners;
    const r0Msg = this.roundsArrivedMessages['round0']
    const r1Msg = this.roundsArrivedMessages['round1']

    allPartners.forEach(sender => {
      const {fxHash: fxHash1, hxHash: hxHash1} = r0Msg[sender].broadcast
      /** match sent hash with Fx & Hx */
      const realFxHash = r1Msg[sender].send

      allPartners.forEach(receiver => {
        const {fxHash: fxHash2, hxHash: hxHash2} = r1Msg[receiver].broadcast.allPartiesCommitmentHash[sender]
        if(fxHash1 !== fxHash2 || hxHash1 !== hxHash2) {
          console.log({fxHash1, hxHash1, fxHash2, hxHash2})
          throw `complain about partner ${sender}`
        }
      })
    })

    /**
     * Propagate data
     */
    const store = {}
    const send = {}
    const broadcast= {
      commitmentHashes: {}
    }

    this.partners.forEach(id => {
      send[id] = {
        Fx: this.store['round0'].Fx.map(pubKey => pubKey.encode('hex', true)),
        Hx: this.store['round0'].Hx.map(pubKey => pubKey.encode('hex', true)),
        f: bn2str(this.store['round0'].fx.calc(id)),
        h: bn2str(this.store['round0'].hx.calc(id)),
      }
      const commitments = preStepBroadcast[id].commitment.map(v => ({t: 'bytes', v}))
      broadcast.commitmentHashes[id] = Web3.utils.soliditySha3(...commitments)
    })

    return {store, send, broadcast}
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId): any {
    // console.log(`mpc complete`, roundsArrivedMessages)
    const firstRoundMessages = roundsArrivedMessages['round1'],
    secondRoundMessages = roundsArrivedMessages['round2']

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
    const nInv = TssModule.toBN(this.partners.length.toString()).invm(TssModule.curve.n)
    share.imul(nInv)
    share = share.umod(TssModule.curve.n)

    let totalFx: PublicKey[] = []
    this.partners.forEach((sender, i) => {
      let Fx = secondRoundMessages[sender].send.Fx;
      if(i === 0)
        totalFx = Fx.map(pub => TssModule.keyFromPublic(pub))
      else {
        Fx.forEach((pub, i) => {
          pub = TssModule.keyFromPublic(pub)
          return totalFx[i] = TssModule.pointAdd(totalFx[i], pub)
        })
      }
    })
    totalFx.forEach((pubKey, i) => {
      totalFx[i] = pubKey.mul(nInv)
    })

    return new DistKey(
      networkId,
      share,
      TssModule.pub2addr(totalFx[0]),
      totalFx[0],
      {
        t: 2,
        Fx: totalFx
      }
    )
  }
}
