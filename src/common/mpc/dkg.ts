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
  commitmentHash: string,
}

/**
 * Round1 input/output types
 */
type Round1Result = any
type Round1Broadcast = {
  Fx: string[],
  Hx: string[],
  // commitment: string[],
  allPartiesCommitmentHash: MapOf<string>
}

/**
 * Round2 input/output types
 */
type Round2Result = {
  share: string
}
type Round2Broadcast = {
}

export type DistKeyJson = {
  index: string,
  share: string,
  address: string,
  publicKey: string,
  curve: {
    t: number,
    Fx: string[]
  }
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

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from the public key of shamir polynomial coefficients.
   * @param idx {string | BN} - index of participant
   * @returns PublicKey
   */
  getPublicKey(idx: BN | string): PublicKey{
    return TssModule.tss.calcPolyPoint(idx, this.curve.Fx)
  }

  toJson(): DistKeyJson {
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

  static fromJson(key: DistKeyJson): DistKey {
    const publicKey = TssModule.keyFromPublic(key.publicKey)
    const address = TssModule.pub2addr(publicKey)
    if(address.toLowerCase() !== key.address.toLowerCase())
      throw `DistKeyJson address mismatched with publicKey`
    return new DistKey(
      key.index,
      TssModule.toBN(key.share),
      address,
      publicKey,
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
      commitmentHash: Web3.utils.soliditySha3(
        ...Fx.map(pubKey => ({t: 'bytes', v: pubKey.encode('hex', true)})),
        ...Hx.map(pubKey => ({t: 'bytes', v: pubKey.encode('hex', true)}))
      )!,
    }
    return {store, send, broadcast}

  }

  round1(prevStepOutput: MapOf<Round0Result>, preStepBroadcast: MapOf<Round0Broadcast>): RoundOutput<Round1Result, Round1Broadcast> {
    const r0Msgs = this.roundsArrivedMessages['round0']
    const allPartiesCommitmentHash = {}
    Object.keys(r0Msgs).forEach(from => {
      allPartiesCommitmentHash[from] = r0Msgs[from].broadcast.commitmentHash
    })

    const store = {}
    const send = {}
    const broadcast= {
      Fx: this.store['round0'].Fx.map(pubKey => pubKey.encode('hex', true)),
      Hx: this.store['round0'].Hx.map(pubKey => pubKey.encode('hex', true)),
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

    /** check each node's commitments sent to all nodes are the same. */
    allPartners.forEach(sender => {
      const {commitmentHash: hash1} = r0Msg[sender].broadcast
      /** match sent hash with Fx & Hx */
      const realHash = Web3.utils.soliditySha3(
        ...r1Msg[sender].broadcast.Fx.map(v => ({t: 'bytes', v})),
        ...r1Msg[sender].broadcast.Hx.map(v => ({t: 'bytes', v}))
      )

      if(hash1 !== realHash)
        throw `complain #1 about partner ${sender}`

      allPartners.forEach(receiver => {
        const hash2 = r1Msg[receiver].broadcast.allPartiesCommitmentHash[sender]
        if(hash1 !== hash2) {
          // console.log({hash1, hash2})
          throw `complain #2 about partner ${sender}`
        }
      })
    })

    /**
     * Propagate data
     */
    const store = {}
    const send = {}
    const broadcast= {}

    this.partners.forEach(id => {
      send[id] = {
        f: bn2str(this.store['round0'].fx.calc(id)),
        h: bn2str(this.store['round0'].hx.calc(id)),
      }
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
        /** check each node's commitments is correct. */
        let {f, h} = secondRoundMessages[fromIndex].send
        f = TssModule.toBN(f)
        h = TssModule.toBN(h)
        const commitment = firstRoundMessages[fromIndex].broadcast.Fx
          .map((_, i) => {
            return TssModule.pointAdd(
              TssModule.keyFromPublic(firstRoundMessages[fromIndex].broadcast.Fx[i]),
              TssModule.keyFromPublic(firstRoundMessages[fromIndex].broadcast.Hx[i])
            )
          })
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
      let Fx = firstRoundMessages[sender].broadcast.Fx;
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
