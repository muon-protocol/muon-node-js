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
import elliptic from 'elliptic'
import * as TssModule from '../../utils/tss/index.js'
import lodash from 'lodash'

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


function resultOk(realKey: string|null, realPubKey: string|null, resultPubKey: string, reconstructedKey, reconstructedPubKey) {
  if(resultPubKey !== reconstructedPubKey)
    return false

  if(realKey) {
    return realKey === reconstructedKey && realPubKey === resultPubKey
  }

  return true
}

async function run() {

  const fakeNet1 = new FakeNetwork(NODE_1),
    fakeNet2 = new FakeNetwork(NODE_2),
    fakeNet3 = new FakeNetwork(NODE_3),
    fakeNet4 = new FakeNetwork(NODE_4)

  const specialPrivateKeys = [
    /** first 5 private keys */
    '0x0000000000000000000000000000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000000000000000000000000000005',

    /** 100 random and unknown private key */
    ...(new Array(100).fill(null)),

    /** 100 random and known private key */
    ...(new Array(100).fill(0).map(() => bn2str(toBN(randomHex(32)).umod(N!)))),

    /** last 5 private keys */
    bn2str(TssModule.curve.n!.subn(5)),
    bn2str(TssModule.curve.n!.subn(4)),
    bn2str(TssModule.curve.n!.subn(3)),
    bn2str(TssModule.curve.n!.subn(2)),
    bn2str(TssModule.curve.n!.subn(1)),
  ]

  const t1 = Date.now()
  for(let i=0 ; i<specialPrivateKeys.length ; i++) {
    const startTime = Date.now();
    // const realPrivateKey = bn2str(toBN(randomHex(32)).umod(N));
    const realPrivateKey = specialPrivateKeys[i];
    const realPubKey = realPrivateKey ? TssModule.keyFromPrivate(realPrivateKey).getPublic().encode("hex", true) : null;

    /** DistributedKeyGen construction data */
    const cData = {
      id: `dkg-${Date.now()}${random()}`,
      partners: [NODE_1, NODE_2, NODE_3, NODE_4],
      t,
      pk: realPrivateKey,
    }

    let keyGen1 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen2 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen3 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen4 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk);

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

    allNodeResults = allNodeResults.map(r => r.toJson())

    const shares = allNodeResults.map(r => ({i: r.index, key: TssModule.keyFromPrivate(r.share)}))
    const reconstructedKey = bn2str(TssModule.reconstructKey(shares, t, 0))
    const reconstructedPubKey = TssModule.keyFromPrivate(reconstructedKey).getPublic().encode('hex', true)

    const pubKeyList = allNodeResults.map(key => key.publicKey)
    if(uniq(pubKeyList).length===1 && resultOk(realPrivateKey, realPubKey, allNodeResults[0].publicKey, reconstructedKey, reconstructedPubKey))
      console.log(`i: ${i}, match: OK, key party: ${allNodeResults[0].partners} time: ${Date.now() - startTime} ms`)
    else {
      console.log(`i: ${i}, match: false`)
      console.log({
        partnersPubKeys: pubKeyList,
        realPrivateKey,
        realPubKey,
        resultPubKey: allNodeResults[0].publicKey,
        reconstructedKey,
        reconstructedPubKey,
      })
    }
  }
  const t2 = Date.now()
  const dt = t2 - t1
  console.log(`  total time: ${Math.round(dt)} ms`)
  console.log(`average time: ${Math.round(dt/specialPrivateKeys.length)} ms`)
}

run()
  .catch(e => {
    console.log("error when running the test.", e)
  })
  .then(() => {
    process.exit(0)
  })
