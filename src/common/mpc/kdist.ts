import {MapOf} from "./types";
import * as TssModule from "../../utils/tss/index.js";
import {PublicKey, PublicKeyShare} from "../../utils/tss/types";
import {DistributedKeyGeneration, DKGOpts} from "./dkg.js";
import {DistKey} from "./dist-key.js";

export type KeyReDistOpts = DKGOpts & {publicKey: string, previousT: number}

export class KeyRedistribution extends DistributedKeyGeneration {
  previousT: number;
  publicKey: string;

  constructor(options: KeyReDistOpts) {
    super(options);
    delete this.constructData.value;
    this.previousT = options.previousT;
    this.publicKey = options.publicKey;
  }

  onComplete(roundsArrivedMessages: MapOf<MapOf<{send: any, broadcast: any}>>, networkId: string, qualified: string[]): any {
    const r1Msgs = this.getRoundReceives('round1')
    const r2Msgs = this.getRoundReceives('round2')
    const {t, previousT} = this

    if(qualified.length < t) {
      throw `Insufficient partner to create the Key.`
    }

    /** share calculation */
    let shares = qualified
      .map(from => ({i: from, key: TssModule.keyFromPrivate(r2Msgs[from].send.f)}))
    const share = TssModule.reconstructKey(shares, previousT);

    let totalFx: PublicKey[] = []
    for(let j=0 ; j<t ; j++) {
      const shares: PublicKeyShare[] = qualified.map(i => ({
        i,
        publicKey: TssModule.keyFromPublic(r1Msgs[i].broadcast.Fx[j])
      }));
      totalFx[j] = TssModule.reconstructPubKey(shares, previousT);
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

