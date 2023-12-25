
import * as TssModule from "../../utils/tss/index.js";
import { MultiPartyComputation } from "./base.js";
import { FrostNonce, FrostCommitment, FrostCommitmentJson, NonceBatch } from "./dist-nonce.js";
import { MapOf, RoundOutput } from "./types.js";

type NonceConstants = Omit<FrostNonce, "commitments">;

/** Round-1 Output */
export type Round1Result = any;
export type Round1Broadcast = {
    /** commitment */
    commitments: FrostCommitmentJson[],
}

/** Round-2 Output */
export type Round2Result = any;
export type Round2Broadcast = any

export type DNGOptions = {
    /** Unique random ID */
    id: string,
    /**
     * Who starts the nonce generation.
     * The nonce-gen will not succeed if the starter gets excluded from the qualified list in the middle of the process.
     */
    starter: string,
    /** The list of all partners who will participate in the signing process later. */
    partners: string[],
    /** The count of nonce that will be generated. */
    n: number,
    /** Extra data that are available on the all partners. */
    extra?: any,
}

export class DistributedNonceGeneration extends MultiPartyComputation {
    readonly n: number;

    constructor(options: DNGOptions) {
        super({rounds: ['round1','round2'], ...options});
        const {n} = options
        this.n = n;
    }

    async round1(_, __, networkId: string, qualified: string[]): Promise<RoundOutput<Round1Result, Round1Broadcast>> {
        const nonces:NonceConstants[] = new Array(this.n).fill(0).map(_ => ({
            d: TssModule.random(), 
            e: TssModule.random()
        }))
        const commitments:FrostCommitment[] = nonces.map(({d, e}) => ({
            D: TssModule.keyFromPrivate(d).getPublic(),
            E: TssModule.keyFromPrivate(e).getPublic(),
        }))

        const store = {nonces, commitments};
        const send: Round1Result = null;
        const broadcast: Round1Broadcast = {
            commitments: commitments.map(({D, E}) => ({
                D: D.encode("hex", true),
                E: E.encode("hex", true),
            }))
        }

        return {store, send, broadcast}
    }

    async round2(prevStepOutput: MapOf<Round1Result>, prevStepBroadcast: MapOf<Round1Broadcast>): 
        Promise<RoundOutput<Round2Result, Round2Broadcast>> {
        const qualifieds = Object.keys(prevStepBroadcast);
        return {store: {}, send: null, broadcast: null, qualifieds}
    }

    onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId: string, qualified: string[]):
        NonceBatch {
        const r1Store = this.getStore('round1');
        const r1Msgs = this.getRoundReceives('round1')

        if(qualified.length < this.t) {
          throw `Insufficient partner to create the Key.`
        }

        const nonces: FrostNonce[] = r1Store.nonces.map(({d, e}, i) => {
            return {
                d,
                e,
                commitments: qualified.reduce((obj, id) => {
                    const {D, E} = r1Msgs[id].broadcast.commitments[i]
                    obj[id]= {
                        D: TssModule.keyFromPublic(D),
                        E: TssModule.keyFromPublic(E),
                    };
                    return obj;
                }, {})
            }
        })

        return new NonceBatch(this.n, qualified, nonces)
    }
}