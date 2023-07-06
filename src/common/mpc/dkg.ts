import {MapOf, RoundOutput, RoundProcessor} from "./types";
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

export class DistributedKeyGeneration extends MultiPartyComputation {

  private readonly value: BN | undefined;
  public readonly extraParams: any;
  protected RoundValidations: object = validations;

  constructor(id: string, starter: string, partners: string[], t: number, value?: BN|string, extra: any={}) {
    // @ts-ignore
    super(['round1', 'round2', 'round3'], ...Object.values(arguments));
    // console.log(`${this.ConstructorName} construct with`, {id, partners, t, value});

    this.extraParams = extra;
    this.t = t
    if(!!value) {
      if(BN.isBN(value))
        this.value = value
      else
        this.value = toBN(value);
    }
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
      // const {commitmentHash: hash1} = r0Msg[sender].broadcast
    //   /** match sent hash with commitment */
    //   const realHash = Web3.utils.soliditySha3(
    //     ...r1Msg[sender].broadcast.commitment.map(v => ({t: 'bytes', v}))
    //   )
    //
    //   if(hash1 !== realHash) {
    //     // throw `complain #1 about partner ${sender}`
    //     console.log(`partner [${sender}] founded malignant at round2 commitment hash matching`)
    //     malignant.push(sender)
    //     return;
    //   }
    //
    //   /** check for the same commitment sent to all parties */
    //   qualified.every(receiver => {
    //     if(!r1Msg[receiver]) {
    //       console.log(`======= receiver: ${receiver} ======`, {qualified})
    //       console.dir(r1Msg, {depth: 4})
    //     }
    //     const hash2 = r1Msg[receiver].broadcast.allPartiesCommitmentHash[sender]
    //     if(hash1 !== hash2) {
    //       // throw `complain #1 about partner ${sender}`
    //       console.log(`partner [${sender}] founded malignant at round2 comparing with others`)
    //       malignant.push(sender)
    //       return false
    //     }
    //     return true;
    //   })
    //
    //   /** check the f & h matches with commitment */
    //   const {f, h} = r1Msg[sender].send
    //   const commitment = r1Msg[sender].broadcast.commitment.map(pubKey => TssModule.keyFromPublic(pubKey))
    //   let p1 = TssModule.calcPolyPoint(networkId, commitment)
    //   let p2 = TssModule.pointAdd(
    //     TssModule.curve.g.mul(toBN(f)),
    //     TssModule.H.mul(toBN(h))
    //   );
    //   if(!p1.eq(p2)) {
    //     // throw `DistributedKey partial data verification failed from partner ${sender}.`
    //     console.log(`partner [${sender}] founded malignant at round2 commitment matching`)
    //     malignant.push(sender)
    //   }
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
    newQualified.forEach(id => {
      send[id] = {
        f: bn2str(this.getStore('round1').fx.calc(id)),
      }
      broadcast.allPartiesFxHash[id] = muonSha3(...prevStepBroadcast[id].Fx.map(v => ({t: 'bytes', v})))
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

