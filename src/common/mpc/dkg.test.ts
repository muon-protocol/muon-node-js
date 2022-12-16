/**
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration} from "./dkg";
import FakeNetwork from './fake-network';

const {toBN, soliditySha3, randomHex} = require('web3').utils
const {shuffle, range} = require('lodash')
const Polynomial = require('../../utils/tss/polynomial')
const TssModule = require('../../utils/tss/index')

const bn2str = num => num.toBuffer('be', 32).toString('hex');
import * as MpcRunner from './runner';

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const t = 2;
// const realPrivateKey = randomHex(32);
const realPrivateKey = '0x9a86896c47daa4d166be4aaee55542a672081b46ca593a8e1d4a080d299a531d';
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

  let [node1Result, node2Result] = await Promise.all([
    /** run partner 1 */
    new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk).process(new FakeNetwork(NODE_1)),
    /** run partner 2 */
    new DistributedKeyGeneration(cData.id, cData.partners, cData.t, cData.pk).process(new FakeNetwork(NODE_2)),
    // MpcRunner.process(DistributedKeyGeneration, constructionData, new FakeNetwork(NODE_2)),
  ]);

  const shares = [
    {i: 1, key: TssModule.keyFromPrivate(node1Result)},
    {i: 2, key: TssModule.keyFromPrivate(node2Result)},
  ]
  const reconstructedKey = TssModule.reconstructKey(shares, t, 0)

  console.log({
    node1Result,
    node2Result,
    PK1: realPrivateKey,
    PK2: '0x'+reconstructedKey.toString('hex', 32),
  })
  process.exit(0)
}

run();


