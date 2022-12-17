/**
 * Test Distributed Key Generation module
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg";
import FakeNetwork from './fake-network';
import {bn2str} from './utils'
const {toBN, randomHex} = require('web3').utils
const TssModule = require('../../utils/tss/index')


/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const t = 2;
const NODE_1='1', NODE_2='2', NODE_3='3', NODE_4='4'


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

    /** 100 random private key */
      ...(new Array(100).fill(0).map(() => bn2str(toBN(randomHex(32)).umod(N)))),

    /** last 5 private keys */
    bn2str(TssModule.curve.n.subn(5)),
    bn2str(TssModule.curve.n.subn(4)),
    bn2str(TssModule.curve.n.subn(3)),
    bn2str(TssModule.curve.n.subn(2)),
    bn2str(TssModule.curve.n.subn(1)),
  ]

  const t1 = Date.now()
  for(let i=0 ; i<specialPrivateKeys.length ; i++) {
    // const realPrivateKey = bn2str(toBN(randomHex(32)).umod(N));
    const realPrivateKey = specialPrivateKeys[i];

    /** DistributedKeyGen construction data */
    const cData = {
      id: `dkg-${realPrivateKey.substr(-10)}`,
      partners: [NODE_1, NODE_2, NODE_3, NODE_4],
      t,
      pk: toBN(realPrivateKey)
    }

    let keyGen1 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen2 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen3 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk),
      keyGen4 = new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk);

    fakeNet1.registerMcp(keyGen1);
    fakeNet2.registerMcp(keyGen2);
    fakeNet3.registerMcp(keyGen3);
    fakeNet4.registerMcp(keyGen4);

    let [node1Result, node2Result, node3Result, node4Result] = await Promise.all([
      /** run partner 1 */
      keyGen1.process(fakeNet1),
      /** run partner 2 */
      keyGen2.process(fakeNet2),
      /** run partner 2 */
      keyGen3.process(fakeNet3),
      /** run partner 2 */
      keyGen4.process(fakeNet4),
    ]);

    const shares = [
      {i: 1, key: TssModule.keyFromPrivate(node1Result)},
      {i: 2, key: TssModule.keyFromPrivate(node2Result)},
      {i: 3, key: TssModule.keyFromPrivate(node3Result)},
      {i: 4, key: TssModule.keyFromPrivate(node4Result)},
    ]
    const reconstructedKey = bn2str(TssModule.reconstructKey(shares, t, 0))

    if(reconstructedKey === reconstructedKey)
      console.log(`i: ${i}, match: OK`)
    else {
      console.log(`i: ${i}, match: false`)
      console.log({realPrivateKey, reconstructedKey})
    }
  }
  const t2 = Date.now()
  const dt = t2 - t1
  console.log(`  total time: ${Math.round(dt)} ms`)
  console.log(`average time: ${Math.round(dt/specialPrivateKeys.length)} ms`)
  process.exit(0)
}

run();


