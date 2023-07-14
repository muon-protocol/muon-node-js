/**
 * Test Distributed Key Generation module
 * Generate Distributed Key
 * Sign message
 * Verify signature
 */
import {DistributedKeyGeneration, DKGOpts} from "./dkg.js";
import {KeyReDistOpts, KeyRedistribution} from "./kdist.js"
import FakeNetwork from './fake-network.js';
import {bn2str} from './utils.js'
import Web3 from 'web3'
import * as TssModule from "../../utils/tss/index.js";
import lodash from 'lodash'
import {DistKeyJson} from "./dist-key.js";
import {toBN} from "../../utils/helpers.js";

const {range, uniq} = lodash
const {randomHex} = Web3.utils

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const threshold = 2;
const nextThreshold = 4;
const partyCount = 6
const partners = range(partyCount).map(i => `${i+1}`)
const random = () => Math.floor(Math.random()*9999999)

export type KeyConstructionData = {
  id: string,
  partners: string[],
  dealers?: string[],
  t: number,
  pk?: string,
}

export type KeyReDistributeData = KeyConstructionData & {previousT: number};

function resultOk(realKey: string|null, realPubKey: string|null, resultPubKey: string, reconstructedKey, reconstructedPubKey) {
  if(resultPubKey !== reconstructedPubKey)
    return false

  if(realKey) {
    return realKey === reconstructedKey && realPubKey === resultPubKey
  }

  return true
}

function checkSharesCorrectness(realPrivateKey, t, keyShares) {
  const realPubKey = realPrivateKey ? TssModule.keyFromPrivate(realPrivateKey).getPublic().encode("hex", true) : null;

  /** check total key reconstruction */
  const shares = keyShares.map(r => ({i: r.index, key: TssModule.keyFromPrivate(r.share)}))
  const reconstructedKey = bn2str(TssModule.reconstructKey(shares.slice(-t), t, 0))
  const reconstructedPubKey = TssModule.keyFromPrivate(reconstructedKey).getPublic().encode('hex', true)

  const pubKeyList = keyShares.map(key => key.publicKey)
  return uniq(pubKeyList).length===1 && resultOk(realPrivateKey, realPubKey, keyShares[0].publicKey, reconstructedKey, reconstructedPubKey)
}

async function keyGen(partners: string[], networks: FakeNetwork[], cData: KeyConstructionData): Promise<DistKeyJson[]> {

  let keyGenOpts: DKGOpts = {
    id: cData.id,
    starter: "1",
    partners: cData.partners,
    t: cData.t,
    value: cData.pk
  }
  let keyGens = partners.map(p => new DistributedKeyGeneration(keyGenOpts))

  let allNodeResults: any[] = await Promise.all(
    partners.map(
      (p, i) => keyGens[i].runByNetwork(networks[i], 20000)
    )
  );

  return allNodeResults.map(r => r.toJson())
}

async function keyRedistribute(
  partners: string[],
  networks: FakeNetwork[],
  cData: KeyReDistributeData,
  shares: DistKeyJson[]
): Promise<DistKeyJson[]> {

  let keyReDistOpts: KeyReDistOpts = {
    id: cData.id,
    starter: "1",
    partners: cData.partners,
    dealers: cData.dealers,
    t: cData.t,
    previousT: cData.previousT,
  }
  let keyReDists = partners.map((p, index) => {
    return new KeyRedistribution({...keyReDistOpts, value: shares[index]?.share})
  })

  let allNodeResults: any[] = await Promise.all(
    partners.map(
      (p, i) => keyReDists[i].runByNetwork(networks[i], 20000)
    )
  );

  return allNodeResults.map(r => r.toJson())
}

async function run() {

  const fakeNets:FakeNetwork[] = partners.map(id => new FakeNetwork(id));

  const specialPrivateKeys = [
    /** first 100 private keys */
    ...(new Array(100).fill(0).map((_, i) => bn2str(toBN(i+1).umod(N!)))),

    /** 100 random and unknown private key */
    ...(new Array(100).fill(null)),

    /** 100 random and known private key */
    ...(new Array(100).fill(0).map(() => bn2str(toBN(randomHex(32)).umod(N!)))),

    /** last 100 private keys */
    ...(new Array(100).fill(0).map((_, i) => bn2str(TssModule.curve.n!.subn(100-i)))),
  ]

  const t1 = Date.now()
  for(let i=0 ; i<specialPrivateKeys.length ; i++) {
    const startTime = Date.now();
    // const realPrivateKey = bn2str(toBN(randomHex(32)).umod(N));
    const realPrivateKey = specialPrivateKeys[i];

    const initialPartners = partners.slice(0, nextThreshold+1);
    let initialKeyShares = await keyGen(initialPartners, fakeNets, {
      id: `dkg-${Date.now()}${random()}`,
      partners: initialPartners,
      t: threshold,
      pk: realPrivateKey,
    });

    if(!checkSharesCorrectness(realPrivateKey, threshold, initialKeyShares)) {
      console.log(`i: ${i+1}/${specialPrivateKeys.length}, initial key share failed`)
      continue;
    }

    let keyShares = await keyRedistribute(
      partners,
      fakeNets,
      {
        id: `kredist-${Date.now()}${random()}`,
        partners,
        dealers: initialPartners,
        previousT: threshold,
        t: nextThreshold,
      },
      initialKeyShares
    );

    if(checkSharesCorrectness(realPrivateKey, nextThreshold, keyShares))
      console.log(`i: ${i+1}/${specialPrivateKeys.length}, match: OK, key party: ${keyShares[0].partners} time: ${Date.now() - startTime} ms`)
    else {
      console.log(`i: ${i+1}/${specialPrivateKeys.length}, match: false`)
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
