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
import * as TssModule from "../../utils/tss/index.js";
import lodash from 'lodash'
import {DistKeyJson} from "./dist-key.js";
import {toBN} from "../../utils/helpers.js";
import {MapOf} from "./types";
import {KeyConstructionData, KeyReDistributeData} from "./kdist.test.js";

const {range, uniq} = lodash

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const N = TssModule.curve.n
const threshold = 2;
const partyCount = 12
const allPartners = range(partyCount).map(i => `${i+1}`)
const random = () => Math.floor(Math.random()*9999999)

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
    starter: (cData.dealers || cData.partners)[0],
    partners: cData.partners,
    dealers: cData.dealers,
    t: cData.t,
    publicKey: cData.publicKey,
    previousPolynomial: cData.previousPolynomial,
  }
  let keyReDists = partners.map(p => {
    const index = (cData.dealers||cData.partners).findIndex(id => id===p);
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

  const fakeNets:MapOf<FakeNetwork> = allPartners.reduce((obj, id) => (obj[id]=new FakeNetwork(id), obj), {});

  const numReshare = 1000;
  const realPrivateKey = bn2str(toBN(1));

  let prevPartners = allPartners.slice(0, threshold+1);
  let prevKeyShares = await keyGen(
    // partners
    prevPartners,
    // networks
    prevPartners.map(id => fakeNets[id]),
    // cData
    {
      id: `dkg-${Date.now()}${random()}`,
      partners: prevPartners,
      t: threshold,
      pk: realPrivateKey,
    }
  );
  if(!checkSharesCorrectness(realPrivateKey, threshold, prevKeyShares))
    throw `key distribution failed`;

  const t1 = Date.now()
  for(let i=0 ; i<numReshare ; i++) {
    const startTime = Date.now();
    // const realPrivateKey = bn2str(toBN(randomHex(32)).umod(N));

    const dealers = prevPartners.slice(0, threshold+1)
    prevKeyShares = prevKeyShares.slice(0, threshold+1)

    const newPartners = lodash.shuffle(allPartners).filter(id => !dealers.includes(id)).slice(0, threshold+1)
    const partners = lodash.shuffle([...dealers, ...newPartners])

    // console.log({dealers, newPartners, partners, prevKeyShares})
    let keyShares = await keyRedistribute(
      partners,
      partners.map(id => fakeNets[id]),
      {
        id: `kredist-${Date.now()}${random()}`,
        partners,
        dealers,
        publicKey: prevKeyShares[0].publicKey,
        previousPolynomial: prevKeyShares[0].polynomial!,
        t: threshold,
      },
      prevKeyShares,
    );
    // console.log(keyShares)

    if(checkSharesCorrectness(realPrivateKey, threshold, keyShares))
      console.log(`i: ${i+1}/${numReshare}, match: OK, key party: ${keyShares[0].partners} time: ${Date.now() - startTime} ms`)
    else {
      console.log(`i: ${i+1}/${numReshare}, match: false`)
      break;
    }

    prevPartners = partners;
    prevKeyShares = keyShares;
  }
  const t2 = Date.now()
  const dt = t2 - t1
  console.log(`  total time: ${Math.round(dt)} ms`)
  console.log(`average time: ${Math.round(dt/numReshare)} ms`)
}

run()
  .catch(e => {
    console.log("error when running the test.", e)
  })
  .then(() => {
    process.exit(0)
  })
