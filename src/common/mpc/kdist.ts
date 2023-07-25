import {MapOf, RoundOutput} from "./types";
import * as TssModule from "../../utils/tss/index.js";
import {PublicKey, PublicKeyShare} from "../../utils/tss/types";
import {
  DistributedKeyGeneration,
  DKGOpts,
  Round1Broadcast,
  Round1Result,
  Round2Broadcast,
  Round2Result
} from "./dkg.js";
import {DistKey} from "./dist-key.js";
import {PolynomialInfoJson} from "../types";

export type KeyReDistOpts = DKGOpts & {
  publicKey: string,
  previousPolynomial: PolynomialInfoJson
}

export class KeyRedistribution extends DistributedKeyGeneration {
  publicKey: string;
  previousPolynomial: PolynomialInfoJson;

  constructor(options: KeyReDistOpts) {
    super(options);
    delete this.constructData.value;
    this.publicKey = options.publicKey;
    this.previousPolynomial = options.previousPolynomial;
  }

  round2(prevStepOutput: MapOf<Round1Result>, prevStepBroadcast: MapOf<Round1Broadcast>, networkId: string, qualified: string[]):
    RoundOutput<Round2Result, Round2Broadcast> {
    const result = super.round2(prevStepOutput, prevStepBroadcast, networkId, qualified);

    const {qualifieds=qualified} = result
    const malignant:string[] = [];

    const previousFx:PublicKey[] = this.previousPolynomial.Fx.map(pub => TssModule.keyFromPublic(pub));
    for(const sender of qualifieds){
      const broadcast:Round1Broadcast = prevStepBroadcast[sender];
      const {Fx} = broadcast;

      const sendersPreviousSharePubKey = TssModule.calcPolyPoint(sender, previousFx).encode("hex", true);
      /** Ensure that the sender has shared its own previous share. */
      if(Fx[0] !== sendersPreviousSharePubKey)
        malignant.push(sender)
    }

    return {
      ...result,
      qualifieds: qualifieds.filter(id => !malignant.includes(id)),
    };
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId: string, qualified: string[]): any {
    const r1Msgs = this.getRoundReceives('round1')
    const r2Msgs = this.getRoundReceives('round2')
    const {t, previousPolynomial} = this

    if(qualified.length < t) {
      throw `Insufficient partner to create the Key.`
    }

    /** share calculation */
    let shares = qualified
      .map(from => ({i: from, key: TssModule.keyFromPrivate(r2Msgs[from].send.f)}))
    const share = TssModule.reconstructKey(shares, previousPolynomial.t);

    let totalFx: PublicKey[] = []
    for(let j=0 ; j<t ; j++) {
      const shares: PublicKeyShare[] = qualified.map(i => ({
        i,
        publicKey: TssModule.keyFromPublic(r1Msgs[i].broadcast.Fx[j])
      }));
      totalFx[j] = TssModule.reconstructPubKey(shares, previousPolynomial.t);
    }

    if(totalFx[0].encode('hex', true) !== this.publicKey)
      throw `reshare error: public key changed. expected: ${this.publicKey} computed: ${totalFx[0].encode('hex', true)}`;

    /** share public key */
    const publicKey1 = TssModule.keyFromPrivate(share).getPublic().encode("hex", true);
    /** node public key at the polynomial */
    const publicKey2 = TssModule.calcPolyPoint(networkId, totalFx).encode("hex", true);

    if(publicKey1 !== publicKey2)
      throw `reshare failed: share public key not matched with polynomial`;

    return new DistKey(
      networkId,
      share,
      TssModule.pub2addr(totalFx[0]),
      totalFx[0],
      qualified,
      {
        t,
        Fx: totalFx
      }
    )
  }
}

