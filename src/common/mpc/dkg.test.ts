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
const NODE_1='1', NODE_2='2'


async function run() {

  const fakeNet1 = new FakeNetwork(NODE_1),
    fakeNet2 = new FakeNetwork(NODE_2)

  for(let i=0 ; i<1000 ; i++) {
    const realPrivateKey = toBN(randomHex(32)).umod(N);

    /** DistributedKeyGen construction data */
    const cData = {
      id: 'dkg-1',
      partners: [NODE_1, NODE_2],
      t,
      pk: toBN(realPrivateKey)
    }

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
    const reconstructedKey = bn2str(TssModule.reconstructKey(shares, t, 0))
    const keyShouldToBe = bn2str(toBN(realPrivateKey).muln(2).umod(N))

    if(reconstructedKey === keyShouldToBe)
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


