import {MapOf, RoundOutput, RoundProcessor} from "./types";
import {MultiPartyComputation} from "./base.js";
import {bn2str} from './utils.js'
import Web3 from 'web3'
import Polynomial from "../../utils/tss/polynomial.js";
import * as TssModule from "../../utils/tss/index.js";
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
type Round1Result = {
  f: string,
  h: string
}
type Round1Broadcast = {
  commitment: string[],
  allPartiesCommitmentHash: MapOf<string>
}

/**
 * Round2 input/output types
 */
type Round2Result = any
type Round2Broadcast = {
  Fx: string[],
  malignant: string[]
}

type Round3Result = any;
type Round3Broadcast = {
  malignant: string[],
}

export type DistKeyJson = {
  index: string,
  share: string,
  address: string,
  publicKey: string,
  partners: string[],
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
  partners: string[];
  curve: {
    t: number,
    Fx: PublicKey[]
  };

  constructor(index: string, share: BN, address: string, publicKey : PublicKey, partners: string[], curve: {t: number, Fx: PublicKey[]}) {
    this.index = index;
    this.share = share;
    this.address = address;
    this.publicKey = publicKey;
    this.partners = partners,
      this.curve = curve;
  }

  /**
   * Returns public key of participant with id of [idx]
   * public key calculated from the public key of shamir polynomial coefficients.
   * @param idx {string | BN} - index of participant
   * @returns PublicKey
   */
  getPublicKey(idx: number | string): PublicKey{
    return TssModule.calcPolyPoint(idx, this.curve.Fx)
  }

  publicKeyLargerThanHalfN() {
    return TssModule.HALF_N.lt(this.publicKey.getX())
  }

  toJson(): DistKeyJson {
    return {
      index: this.index,
      share: bn2str(this.share),
      address: this.address,
      publicKey: this.publicKey.encode('hex', true),
      partners: this.partners,
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
      key.partners,
      {
        t: key.curve.t,
        Fx: key.curve.Fx.map(p => TssModule.keyFromPublic(p))
      },
    );
  }
}

const pattern_id = "^[1-9][0-9]*$";
const schema_uint32 = {type: 'string', pattern: `^0x[0-9A-Fa-f]{64}$`};
const schema_public_key = {type: 'string', pattern: `^[0-9A-Fa-f]{66}$`};
const InputSchema = {
  'round0': {
    type: 'object',
    properties: {
      broadcast: {
        type: 'object',
        properties: {
          commitmentHash: schema_uint32
        },
        required: ['commitmentHash'],
      }
    },
    required: ['broadcast'],
  },
  'round1': {
    type: 'object',
    properties: {
      send: {
        type: 'object',
        properties: {
          f: schema_uint32,
          h: schema_uint32,
        },
        required: ['f', 'h']
      },
      broadcast: {
        type: 'object',
        properties: {
          commitment: {
            type: 'array',
            items: schema_public_key
          },
          allPartiesCommitmentHash: {
            type: 'object',
            patternProperties: {
              [pattern_id]: schema_uint32
            }
          }
        },
        required: ['commitment', 'allPartiesCommitmentHash']
      },
    },
    required: ['send', 'broadcast']
  },
  'round2':{
    type: 'object',
    properties: {
      broadcast: {
        type: 'object',
        properties: {
          Fx: {
            type: 'array',
            items: schema_public_key
          },
          malignant: {
            type: "array",
            items: {
              type: 'string',
              pattern: pattern_id
            }
          }
        },
        required: ['Fx', 'malignant']
      }
    },
    required: ['broadcast']
  },
  'round3': {
    type: 'object',
    properties: {
      broadcast: {
        type: 'object',
        properties: {
          malignant: {
            type: 'array',
            items: {
              type: 'string',
              pattern: pattern_id
            }
          }
        },
        required: ['malignant']
      }
    },
    required: ['broadcast']
  }
}

export class DistributedKeyGeneration extends MultiPartyComputation {

  private readonly value: BN | undefined;
  public readonly extraParams: any;
  protected InputSchema: object = InputSchema;

  constructor(id: string, starter: string, partners: string[], t: number, value?: BN|string, extra: any={}) {
    // @ts-ignore
    super(['round0', 'round1', 'round2', 'round3'], ...Object.values(arguments));
    // console.log(`${this.ConstructorName} construct with`, {id, partners, t, value});

    this.extraParams = extra;
    this.t = t
    if(!!value) {
      if(BN.isBN(value))
        this.value = value
      else
        this.value = Web3.utils.toBN(value);
    }
  }

  round0(_, __, networkId: string, qualified: string[]): RoundOutput<Round0Result, Round0Broadcast> {
    // @ts-ignore
    let fx = new Polynomial(this.t, TssModule.curve, this.value ? TssModule.toBN(this.value) : undefined);
    let hx = new Polynomial(this.t, TssModule.curve);

    const Fx = fx.coefPubKeys();
    const Hx = hx.coefPubKeys(TssModule.H)
    const commitment = Fx.map((Fxi, i) => TssModule.pointAdd(Fxi, Hx[i])).map(k => k.encode('hex', true))

    const store = {fx, hx, Fx, Hx, commitment}
    const send = {}
    const broadcast= {
      commitmentHash: Web3.utils.soliditySha3(
        ...commitment.map(pubKey => ({t: 'bytes', v: pubKey})),
      )!
    }
    return {store, send, broadcast}
  }

  async round1(prevStepOutput: MapOf<Round0Result>, preStepBroadcast: MapOf<Round0Broadcast>, networkId: string, qualified: string[]):
    Promise<RoundOutput<Round1Result, Round1Broadcast>> {
    const r0Msgs = this.getRoundReceives('round0')

    /** broadcast all commitment hashes received from other participants */
    const allPartiesCommitmentHash = {}
    Object.keys(r0Msgs).forEach(from => {
      allPartiesCommitmentHash[from] = r0Msgs[from].broadcast.commitmentHash
    })

    const store = {}
    const send = {}

    qualified.forEach(id => {
      send[id] = {
        f: bn2str(this.getStore('round0').fx.calc(id)),
        h: bn2str(this.getStore('round0').hx.calc(id)),
      }
    })

    const broadcast= {
      commitment: this.getStore('round0').commitment,
      allPartiesCommitmentHash
    }

    return {store, send, broadcast, qualifieds: qualified}
  }

  round2(prevStepOutput: MapOf<Round1Result>, preStepBroadcast: MapOf<Round1Broadcast>, networkId: string, qualified: string[]):
    RoundOutput<Round2Result, Round2Broadcast> {
    /**
     * Check all partners broadcast same commitment to all other parties.
     */
    const r0Msg = this.getRoundReceives('round0')
    const r1Msg = this.getRoundReceives('round1')

    const malignant: string[] = [];

    /** check each node's commitments sent to all nodes are the same. */
    qualified.forEach(sender => {
      const {commitmentHash: hash1} = r0Msg[sender].broadcast
      /** match sent hash with commitment */
      const realHash = Web3.utils.soliditySha3(
        ...r1Msg[sender].broadcast.commitment.map(v => ({t: 'bytes', v}))
      )

      if(hash1 !== realHash) {
        // throw `complain #1 about partner ${sender}`
        console.log(`partner [${sender}] founded malignant at round2 commitment hash matching`)
        malignant.push(sender)
        return;
      }

      /** check for the same commitment sent to all parties */
      qualified.every(receiver => {
        if(!r1Msg[receiver]) {
          console.log(`======= receiver: ${receiver} ======`, {qualified})
          console.dir(r1Msg, {depth: 4})
        }
        const hash2 = r1Msg[receiver].broadcast.allPartiesCommitmentHash[sender]
        if(hash1 !== hash2) {
          // throw `complain #1 about partner ${sender}`
          console.log(`partner [${sender}] founded malignant at round2 comparing with others`)
          malignant.push(sender)
          return false
        }
        return true;
      })

      /** check the f & h matches with commitment */
      const {f, h} = r1Msg[sender].send
      const commitment = r1Msg[sender].broadcast.commitment.map(pubKey => TssModule.keyFromPublic(pubKey))
      let p1 = TssModule.calcPolyPoint(networkId, commitment)
      let p2 = TssModule.pointAdd(
        TssModule.curve.g.mul(TssModule.toBN(f)),
        TssModule.H.mul(TssModule.toBN(h))
      );
      if(!p1.eq(p2)) {
        // throw `DistributedKey partial data verification failed from partner ${sender}.`
        console.log(`partner [${sender}] founded malignant at round2 commitment matching`)
        malignant.push(sender)
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
      Fx: this.getStore('round0').Fx.map(pubKey => pubKey.encode('hex', true)),
      malignant,
    }
    return {store, send, broadcast, qualifieds: newQualified}
  }

  round3(prevStepOutput: MapOf<Round2Result>, preStepBroadcast: MapOf<Round2Broadcast>, networkId: string, qualified: string[]):
    RoundOutput<Round3Result, Round3Broadcast> {
    /**
     * Check all partners broadcast same commitment to all other parties.
     */
    const r1Msgs = this.getRoundReceives('round1')
    const r2Msgs = this.getRoundReceives('round2')

    const malignant: string[] = []
    /** verify round2.broadcast.Fx received from all partners */
    qualified.map(sender => {
      const Fx = r2Msgs[sender].broadcast.Fx.map(k => TssModule.keyFromPublic(k))
      const p1 = TssModule.calcPolyPoint(networkId, Fx);
      const p2 = TssModule.curve.g.mul(TssModule.toBN(r1Msgs[sender].send.f))
      if(!p1.eq(p2)) {
        console.log(`partner [${sender}] founded malignant at round3 Fx check`)
        malignant.push(sender);
      }
    })

    /**
     * Propagate data
     */
    const newQualified = qualified.filter(id => !malignant.includes(id));

    const store = {}
    const send = {}
    const broadcast= {
      malignant,
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
      .map(from => r1Msgs[from].send.f)
      .reduce((acc, current) => {
        acc.iadd(TssModule.toBN(current))
        return acc
      }, TssModule.toBN('0'))
    const nInv = TssModule.toBN(qualified.length.toString()).invm(TssModule.curve.n!)
    share.imul(nInv)
    share = share.umod(TssModule.curve.n)

    let totalFx: PublicKey[] = []
    qualified.forEach((sender, i) => {
      let Fx = r2Msgs[sender].broadcast.Fx;
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
        t: 2,
        Fx: totalFx
      }
    )
  }
}

