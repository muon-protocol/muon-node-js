/**
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg";
import FakeNetwork from './fake-network';
import {bn2str} from './utils'
const {toBN, soliditySha3, randomHex} = require('web3').utils
const {shuffle, range} = require('lodash')
const Polynomial = require('../../utils/tss/polynomial')
const TssModule = require('../../utils/tss/index')


/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const t = 2;
// const realPrivateKey = randomHex(32);
// const realPrivateKey = '0x9a86896c47daa4d166be4aaee55542a672081b46ca593a8e1d4a080d299a531d';
const realPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000002';
console.log(`real PK:`, realPrivateKey)

const NODE_1='1', NODE_2='2'


async function run() {
  /** DistributedKeyGen construction data */
  const cData = {
    id: 'dkg-1',
    partners: [NODE_1, NODE_2],
    t,
    pk: toBN(realPrivateKey)
  }

  const fakeNet1 = new FakeNetwork(NODE_1), fakeNet2 = new FakeNetwork(NODE_2)

  for(let i=0 ; i<100 ; i++) {
    let [node1Result, node2Result] = await Promise.all([
      /** run partner 1 */
      new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk).process(fakeNet1),
      /** run partner 2 */
      new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk).process(fakeNet2),
      // MpcRunner.process(DistributedKeyGeneration, constructionData, new FakeNetwork(NODE_2)),
    ]);

    const shares = [
      {i: 1, key: TssModule.keyFromPrivate(node1Result)},
      {i: 2, key: TssModule.keyFromPrivate(node2Result)},
    ]
    const reconstructedKey = '0x' + bn2str(toBN(TssModule.reconstructKey(shares, t, 0)).divn(2).umod(N));

    if(reconstructedKey === realPrivateKey)
      console.log(`i: ${i}, match: OK`)
    else {
      console.log(`i: ${i}, match: false`)
      console.log({
        PK1: realPrivateKey,
        PK2: reconstructedKey,
      })
    }
  }
  process.exit(0)
}

run();


