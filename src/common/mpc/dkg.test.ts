/**
 * Test Distributed Key Generation module
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg.js";
import FakeNetwork from './fake-network.js';
import {bn2str} from './utils.js'
import Web3 from 'web3'
import * as noble from "@noble/secp256k1"
import elliptic from 'elliptic'
import * as TssModule from '../../utils/tss/index.js'
import lodash from 'lodash'
import {bigint2hex, buf2bigint, buf2str} from "../../utils/tss/utils.js";

type PublicKey = noble.Point;
const {uniq} = lodash
const {toBN, randomHex} = Web3.utils
const ellipticCurve = new elliptic.ec('secp256k1');

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const t = 2;
const NODE_1='1', NODE_2='2', NODE_3='3', NODE_4='4'
const random = () => Math.floor(Math.random()*9999999)


function resultOk(realKey: bigint|null, realPubKey: PublicKey|null, resultPubKey: PublicKey, reconstructedKey: bigint, reconstructedPubKey: PublicKey) {
  if(!resultPubKey.equals(reconstructedPubKey))
    return false

  if(realKey) {
    return realKey === reconstructedKey && !!realPubKey && realPubKey.equals(resultPubKey)
  }

  return true
}

async function run() {
  const fakeNet1 = new FakeNetwork(NODE_1),
    fakeNet2 = new FakeNetwork(NODE_2),
    fakeNet3 = new FakeNetwork(NODE_3),
    fakeNet4 = new FakeNetwork(NODE_4)

  const specialPrivateKeys: bigint[] = [
    /** first 5 private keys */
    BigInt('0x0000000000000000000000000000000000000000000000000000000000000001'),
    BigInt('0x0000000000000000000000000000000000000000000000000000000000000002'),
    BigInt('0x0000000000000000000000000000000000000000000000000000000000000003'),
    BigInt('0x0000000000000000000000000000000000000000000000000000000000000004'),
    BigInt('0x0000000000000000000000000000000000000000000000000000000000000005'),

    /** 100 random and unknown private key */
    ...(new Array(100).fill(null)),

    /** 100 random and known private key */
      ...(new Array(100).fill(0).map(() => buf2bigint(noble.utils.randomPrivateKey()))),

    /** last 5 private keys */
    TssModule.curve.n - 5n,
    TssModule.curve.n - 4n,
    TssModule.curve.n - 3n,
    TssModule.curve.n - 2n,
    TssModule.curve.n - 1n,
  ]

  for(let i=0 ; i<specialPrivateKeys.length ; i++) {
    const t0 = Date.now()
    // const realPrivateKey = bn2str(toBN(randomHex(32)).umod(N));
    const realPrivateKey: bigint|null = specialPrivateKeys[i];
    const realPrivateKeyStr = realPrivateKey ? bigint2hex(realPrivateKey!) : undefined;
    const realPubKey: PublicKey|null = realPrivateKey ? noble.Point.fromHex(noble.getPublicKey(realPrivateKey!)) : null;

    /** DistributedKeyGen construction data */
    const cData = {
      id: `dkg-${Date.now()}${random()}`,
      partners: [NODE_1, NODE_2, NODE_3, NODE_4],
      t,
      pk: realPrivateKey,
    }

    let keyGen1 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, realPrivateKeyStr),
      keyGen2 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, realPrivateKeyStr),
      keyGen3 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, realPrivateKeyStr),
      keyGen4 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, realPrivateKeyStr);

    let allNodeResults: any[] = await Promise.all([
      /** run partner 1 */
      keyGen1.runByNetwork(fakeNet1),
      /** run partner 2 */
      keyGen2.runByNetwork(fakeNet2),
      /** run partner 2 */
      keyGen3.runByNetwork(fakeNet3),
      /** run partner 2 */
      keyGen4.runByNetwork(fakeNet4),
    ]);

    const shares = allNodeResults.map(r => ({i: r.index, key: r.share}))
    const reconstructedKey: bigint = TssModule.reconstructKey(shares, t, 0n)
    const reconstructedPubKey: PublicKey = noble.Point.fromHex(noble.getPublicKey(reconstructedKey))

    const pubKeyList = allNodeResults.map(key => key.publicKey.toHex(true))
    if(uniq(pubKeyList).length===1 && resultOk(realPrivateKey, realPubKey, allNodeResults[0].publicKey, reconstructedKey, reconstructedPubKey))
      console.log(`i: ${i}, match: OK, key party: ${allNodeResults[0].partners} time: ${Date.now()-t0} ms`)
    else {
      console.log(`i: ${i}, match: false`)
      console.log({
        partnersPubKeys: pubKeyList,
        realPrivateKey: realPrivateKeyStr,
        realPubKey: !!realPubKey ? realPubKey!.toHex(true) : null,
        resultPubKey: allNodeResults[0].publicKey.toHex(true),
        reconstructedKey: bigint2hex(reconstructedKey),
        reconstructedPubKey: reconstructedPubKey.toHex(true),
      })
      throw 'test failed';
    }
  }
}

run()
  .catch(e => {
    console.log("error when running the test.", e)
  })
  .then(() => {
    process.exit(0)
  })


