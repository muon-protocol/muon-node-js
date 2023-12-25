/**
 * Test Distributed Key Generation module
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg.js";
import {DistributedNonceGeneration} from "./dng.js";
import {DistKeyJson} from "./dist-key.js";
import {NonceBatch} from "./dist-nonce.js";
import FakeNetwork from './fake-network.js';
import {bn2str} from './utils.js'
import * as TssModule from '../../utils/tss/index.js'
import {toBN} from "../../utils/tss/utils.js";
import lodash from 'lodash'
import { MapOf } from "./types.js";
import { PublicKey } from "../../utils/tss/types.js";

const {range, shuffle} = lodash

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const threshold = 3;
const partners = range(threshold*2).map(i => `${i+1}`)
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
    n: number
}

async function keyGen(partners: string[], networks: FakeNetwork[], cData: KeyConstructionData): 
Promise<MapOf<DistKeyJson>> {

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

  return allNodeResults.reduce((res, r, i) => (res[partners[i]] = r.toJson(), res), {});
}

async function nonceGen(networks: FakeNetwork[], cData: NonceConstructionData): 
    Promise<MapOf<NonceBatch>> {
    let nonceGens = partners.map(p => new DistributedNonceGeneration({
        id: cData.id,
        starter: "1",
        partners: cData.partners,
        n: cData.n
      }));
    
    let nonceBatches: any[] = await Promise.all(
        partners.map(
            (p, i) => nonceGens[i].runByNetwork(networks[i], 20000)
        )
    );

    return partners.reduce((obj, id, i) => (obj[id]=nonceBatches[i], obj), {});
}

function verify(R: PublicKey, Y:PublicKey, sign:string, m:string): boolean {
    const e = TssModule.schnorrHash(Y, TssModule.pub2addr(R), m);
    const p1 = TssModule.curve.g.mul(toBN(sign));
    const p2 = p1.add(Y.mul(toBN(e))).encode("hex", true);
    return R.encode("hex", true) == p2;
}

async function run() {
  console.log("start ...");
  const fakeNets:FakeNetwork[] = partners.map(id => new FakeNetwork(id));

  const m: string = bn2str(TssModule.random());

  let longTermKeyShares: MapOf<DistKeyJson> = await keyGen(partners, fakeNets, {
    id: `dkg-${Date.now()}${random()}`,
    partners,
    t: threshold
  });

  const Y:PublicKey = TssModule.keyFromPublic(longTermKeyShares[partners[0]].publicKey);

  const batchSize = 4;
  const nonceBatchs: MapOf<NonceBatch> = await nonceGen(fakeNets, {
    id: "sample-nonce",
    partners,
    n: batchSize
  });

  const t1 = Date.now()
  for(let batchIndex=0 ; batchIndex<batchSize ; batchIndex++) {
    const startTime = Date.now();

    const S = shuffle(partners).slice(0, threshold);

    const partialSigns: TssModule.FrostSign[] = S.map((id):TssModule.FrostSign => {
        const nonceBatch:NonceBatch = nonceBatchs[id];
        const key = longTermKeyShares[id];
        return TssModule.frostSign(
          m,
          {
            share: toBN(key.share),
            pubKey: TssModule.keyFromPublic(key.publicKey)
          },
          nonceBatch.nonces[batchIndex],
          S,
          S.findIndex(i => i == id),
          S.reduce((obj, id) => {
            obj[id] = {
              i: parseInt(id), 
              ...nonceBatch.nonces[batchIndex].commitments[id]
            }
            return obj;
          }, {})
        )
    })

    const totalSign = TssModule.frostAggregateSigs(partialSigns);
    const verified = verify(totalSign.R, Y, bn2str(totalSign.s), m);

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
