/**
 * Test Distributed Key Generation module
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg.js";
import {DistributedNonceGeneration} from "./dng.js";
import {DistKeyJson} from "./dist-key.js";
import {DistNonce, DistNonceCommitment, DistNonceCommitmentJson, NonceBatch, NonceBatchJson} from "./dist-nonce.js";
import FakeNetwork from './fake-network.js';
import {bn2str} from './utils.js'
import BN from "bn.js";
import Web3 from 'web3'
import elliptic from 'elliptic'
import * as TssModule from '../../utils/tss/index.js'
import {toBN} from "../../utils/tss/utils.js";
import lodash from 'lodash'
import { MapOf } from "./types.js";
import { PublicKey } from "../../utils/tss/types.js";
import { muonSha3, soliditySha3 } from "../../utils/sha3.js";

const {range, uniq} = lodash
const {randomHex} = Web3.utils
const ellipticCurve = new elliptic.ec('secp256k1');

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const threshold = 3;
const partners = range(threshold).map(i => `${i+1}`)
const random = () => Math.floor(Math.random()*9999999)

type KeyConstructionData = {
  id: string,
  partners: string[],
  t: number,
  pk?: string,
}

type NonceConstructionData = {
    id: string,
    partners: string[],
    pi: number
}

function resultOk(realKey: string|null, realPubKey: string|null, resultPubKey: string, reconstructedKey, reconstructedPubKey) {
  if(resultPubKey !== reconstructedPubKey)
    return false

  if(realKey) {
    return realKey === reconstructedKey && realPubKey === resultPubKey
  }

  return true
}

async function keyGen(partners: string[], networks: FakeNetwork[], cData: KeyConstructionData): Promise<DistKeyJson[]> {

  let keyGens = partners.map(p => new DistributedKeyGeneration({
    id: cData.id,
    starter: "1",
    partners: cData.partners,
    t: cData.t,
    value: cData.pk
  }));

  let allNodeResults: any[] = await Promise.all(
    partners.map(
      (p, i) => keyGens[i].runByNetwork(networks[i], 20000)
    )
  );

  return allNodeResults.map(r => r.toJson())
}

async function nonceGen(networks: FakeNetwork[], cData: NonceConstructionData): 
    Promise<MapOf<NonceBatch>> {
    let nonceGens = partners.map(p => new DistributedNonceGeneration({
        id: cData.id,
        starter: "1",
        partners: cData.partners,
        pi: cData.pi
      }));
    
    let nonceBatches: any[] = await Promise.all(
        partners.map(
            (p, i) => nonceGens[i].runByNetwork(networks[i], 20000)
        )
    );

    return partners.reduce((obj, id, i) => (obj[id]=nonceBatches[i], obj), {});
}

function H1(l, m, B): string {
    return muonSha3(
        {t: "uint32", v: l},
        {t: "uint256", v: m},
        ...B.map(({i}) => ({t: "uint32", v: i})),
        ...B.map(({D}) => ({t: "byte[]", v: D.encode("hex", true)})),
        ...B.map(({E}) => ({t: "byte[]", v: E.encode("hex", true)}))
    )
}

function H2(R:PublicKey, Y:PublicKey, m:string): string {
    return muonSha3(
        {t: "bytes", v: R.encode("hex", true)},
        {t: "bytes", v: Y.encode("hex", true)},
        {t: "uint256", v: m},
    )
}

function verify(R: PublicKey, Y:PublicKey, z:string, m:string): boolean {
    const e = H2(R, Y, m);
    const p1 = TssModule.curve.g.mul(toBN(z)).encode("hex", true);
    const p2 = R.add(Y.mul(toBN(e))).encode("hex", true);
    console.log({p1, p2})
    return p1 == p2;
}

async function run() {
  const fakeNets:FakeNetwork[] = partners.map(id => new FakeNetwork(id));

  const m: string = bn2str(TssModule.random());

  let longTermKeyShares = await keyGen(partners, fakeNets, {
    id: `dkg-${Date.now()}${random()}`,
    partners,
    t: threshold
  });

  const Y:PublicKey = TssModule.keyFromPublic(longTermKeyShares[0].publicKey);

  const pi = 4;
  const nonceBatch: MapOf<NonceBatch> = await nonceGen(fakeNets, {
    id: "sample-nonce",
    partners,
    pi
  });

//   console.dir(
//     nonceBatch[1].toJson(),
//     {depth: 5}
//   )

  const t1 = Date.now()
  for(let batchIndex=0 ; batchIndex<pi ; batchIndex++) {
    const startTime = Date.now();

    const S = partners;

    const B = S.map((id, i) => {
        const commitment: DistNonceCommitment = nonceBatch[id].commitments[id][batchIndex];
        return {i:i+1, D: commitment.D, E: commitment.E}
    });

    const rho: BN[] = S.map((id, i) => toBN(H1(i, m, B)));
    const R:PublicKey = S.reduce((res: undefined|PublicKey, id, i): PublicKey => {
        const {D, E} = B[i];
        const DE = TssModule.pointAdd(D, E.mul(rho[i]));
        return TssModule.pointAdd(res, DE)
    }, undefined)!;
    const c:BN = toBN(H2(R, Y, m));

    const iList = S.map((_, i) => ({i: i+1}));
    const z: BN[] = S.map((id, i):BN => {
        const {d, e} = nonceBatch[id].nonces[batchIndex];
        const s: BN = toBN(longTermKeyShares[i].share)
        console.log(iList, i);
        const lambda:BN = TssModule.lagrangeCoef(i, threshold, iList, "0");
        return d
            .add(e.mul(rho[i]))
            .add(lambda.mul(s).mul(c))
    })

    const totalZ = z.reduce((res:BN, zi) => res.add(zi), toBN("0")).umod(TssModule.curve.n!);
    const verified = verify(R, Y, bn2str(totalZ), m);

    console.log(`i: ${batchIndex}, match: ${verified ? "" : "not "}verified, time: ${Date.now() - startTime} ms`)
  }
}

run()
  .catch(e => {
    console.log("error when running the test.", e)
  })
  .then(() => {
    process.exit(0)
  })
