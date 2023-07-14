import {MapOf, RoundOutput} from "./types";
import validations from './dkg-validations.js';
import {MultiPartyComputation} from "./base.js";
import {bn2str} from './utils.js'
import Polynomial from "../../utils/tss/polynomial.js";
import * as TssModule from "../../utils/tss/index.js";
import {PublicKey} from "../../utils/tss/types";
import BN from 'bn.js';
import {muonSha3} from "../../utils/sha3.js";
import {DistKey} from "./dist-key.js";

import {toBN} from "../../utils/helpers.js";

/**
 * Round1 input/output types
 */
type Round1Result = any
type Round1Broadcast = {
  /** commitment */
  Fx: string[],
  /** proof of possession */
  sig: {
    /** PublicKey of random generated nonce */
    nonce: string,
    /** schnorr signature */
    signature: string,
  },
}

/**
 * Round2 input/output types
 */
type Round2Result = {
  /** key share */
  f: string,
}
type Round2Broadcast = {
  /**
   hash of commitment received from other parties
   will be used in malicious behaviour detection
   */
  allPartiesFxHash: MapOf<string>,
}

/**
 * broadcast malicious partners
 */
type Round3Result = any;
type Round3Broadcast = {
  malicious: string[],
}

export type DKGOpts = {
  /** Unique random ID */
  id: string,
  /**
   * Who starts the key generation.
   * The key-gen will not succeed if the starter gets excluded from the qualified list in the middle of the process.
   */
  starter: string,
  /** Consists of all the partners who will receive a key share after the key-gen gets completed. */
  partners: string[],
  /**
   * All partners may not allowed to initialize the key-gen.
   * Dealers are the partners who generate the initial polynomials and distribute the key shares.
   * If no dealers are specified, all partners will act as dealers.
   */
  dealers?: string[],
  /** TSS threshold */
  t: number,
  /** Some times its may be needed to distribute specific known value. */
  value?: BN | string,
  /** Extra data that are available on the all partners. */
  extra?: any,
}

export class DistributedKeyGeneration extends MultiPartyComputation {

  protected dealers: string[];
  private readonly value: BN | undefined;
  public readonly extraParams: any;
  protected RoundValidations: object = validations;

  constructor(options: DKGOpts) {
    super({rounds: ['round1','round2', 'round3'], ...options});
    const {t, dealers, partners, value, extra} = options


    this.dealers = !!dealers ? dealers : partners;
    this.extraParams = extra;
    this.t = t
    if(!!value) {
      if(BN.isBN(value))
        this.value = value
      else
        this.value = toBN(value);
    }
  }

  getInitialQualifieds(): string[] {
    return [...this.dealers];
  }

  async round1(_, __, networkId: string, qualified: string[]): Promise<RoundOutput<Round1Result, Round1Broadcast>> {
    // @ts-ignore
    let fx = new Polynomial(this.t, TssModule.curve, this.value ? toBN(this.value) : undefined);
    const Fx = fx.coefPubKeys();

    const k: BN = TssModule.random();
    const kPublic = TssModule.keyFromPrivate(k).getPublic();

    const popMsg = muonSha3(
      /** i */
      {type: "uint64", value: networkId},
      /** CTX */
      {type: "string", value: this.id},
      /** g^(ai0) */
      {type: "bytes", value: '0x'+Fx[0].encode('hex', true)},
      /** Ri = g^k */
      {type: "bytes", value: "0x"+kPublic.encode('hex', true)},
    )
    const popSign = TssModule.schnorrSign(fx.coefficients[0].getPrivate(), k, kPublic, popMsg)
    const sig = {
      nonce: kPublic.encode('hex', true),
      signature: TssModule.stringifySignature(popSign)
    }

    const store = {fx, Fx, sig}
    const send: Round1Result = {}
    const broadcast:Round1Broadcast = {
      Fx: Fx.map(pubKey => pubKey.encode('hex', true)),
      sig
    }

    return {store, send, broadcast}
  }

  round2(prevStepOutput: MapOf<Round1Result>, prevStepBroadcast: MapOf<Round1Broadcast>, networkId: string, qualified: string[]):
    RoundOutput<Round2Result, Round2Broadcast> {
    /**
     * Check all partners broadcast same commitment to all other parties.
     */
    const r1Msg = this.getRoundReceives('round1')

    const malignant: string[] = [];

    /** check each node's commitments sent to all nodes are the same. */
    qualified.forEach(sender => {
      const {Fx, sig: {nonce, signature}} = prevStepBroadcast[sender];
      const popHash = muonSha3(
        /** i */
        {type: "uint64", value: sender},
        /** CTX */
        {type: "string", value: this.id},
        /** g^(ai0) */
        {type: "bytes", value: '0x'+Fx[0]},
        /** Ri = g^k */
        {type: "bytes", value: nonce},
      )
      const verified = TssModule.schnorrVerify(
        TssModule.keyFromPublic(Fx[0]),
        popHash,
        signature
      );
      if(!verified) {
        malignant.push(sender)
        return;
      }
    })

    /**
     * Propagate data
     */

    /** exclude malignant from qualified list */
    const newQualified = qualified
      .filter(id => !malignant.includes(id))

    const store = {}
    const send = {}
    const broadcast= {
      allPartiesFxHash: {}
      // Fx: this.getStore('round0').Fx.map(pubKey => pubKey.encode('hex', true)),
      // malignant,
    }
    this.partners.forEach(id => {
      send[id] = {
        f: bn2str(this.getStore('round1').fx.calc(id)),
      }
      if(qualified.includes(id)) {
        broadcast.allPartiesFxHash[id] = muonSha3(...prevStepBroadcast[id].Fx.map(v => ({t: 'bytes', v})))
      }
    })
    return {store, send, broadcast, qualifieds: newQualified}
  }

  round3(prevStepOutput: MapOf<Round2Result>, preStepBroadcast: MapOf<Round2Broadcast>, networkId: string, qualified: string[]):
    RoundOutput<Round3Result, Round3Broadcast> {
    /**
     * Check all partners broadcast same commitment to all other parties.
     */
    const r1Msgs = this.getRoundReceives('round1')
    const r2Msgs = this.getRoundReceives('round2')

    const malicious: string[] = []

    /** verify round2.broadcast.Fx received from all partners */
    qualified.map(sender => {
      /** sender commitment hash */
      const senderFxHash = muonSha3(...r1Msgs[sender].broadcast.Fx.map(v => ({t: 'bytes', v})));

      /** check for the same commitment sent to all parties */
      qualified.every(receiver => {
        const senderFxSentToReceiver = r2Msgs[receiver].broadcast.allPartiesFxHash[sender]
        if(senderFxHash !== senderFxSentToReceiver) {
          console.log(`partner [${sender}] founded malignant at round2 comparing commitment with others`)
          malicious.push(sender)
          return false
        }
        return true;
      })

      const Fx = r1Msgs[sender].broadcast.Fx.map(k => TssModule.keyFromPublic(k))
      const p1 = TssModule.calcPolyPoint(networkId, Fx);
      const p2 = TssModule.curve.g.mul(toBN(r2Msgs[sender].send.f))
      if(!p1.eq(p2)) {
        console.log(`partner [${sender}] founded malignant at round3 Fx check`)
        malicious.push(sender);
      }
    })

    /**
     * Propagate data
     */
    const newQualified = qualified.filter(id => !malicious.includes(id));

    const store = {}
    const send = {}
    const broadcast= {
      malicious,
    }

    return {store, send, broadcast, qualifieds: newQualified}
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId: string, qualified: string[]): any {
    // console.log(`mpc complete`, roundsArrivedMessages)
    const r1Msgs = this.getRoundReceives('round1')
    const r2Msgs = this.getRoundReceives('round2')

    if(qualified.length < this.t) {
      throw `Insufficient partner to create the Key.`
    }

    /** share calculation */
    let share = qualified
      .map(from => r2Msgs[from].send.f)
      .reduce((acc, current) => {
        acc.iadd(toBN(current))
        return acc
      }, toBN('0'))
    const nInv = toBN(qualified.length.toString()).invm(TssModule.curve.n!)
    share.imul(nInv)
    share = share.umod(TssModule.curve.n)

    let totalFx: PublicKey[] = []
    qualified.forEach((sender, i) => {
      let Fx = r1Msgs[sender].broadcast.Fx;
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

    //console.log(`dkg[${this.id}].onComplete keyId: ${this.extraParams?.keyId}`, {qualified})

    return new DistKey(
      networkId,
      share,
      TssModule.pub2addr(totalFx[0]),
      totalFx[0],
      qualified,
      {
        t: this.t,
        Fx: totalFx
      }
    )
  }
}

