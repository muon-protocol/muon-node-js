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
import _ from 'lodash'
import {DistKeyJson} from "./dist-key.js";
import {toBN} from "../../utils/helpers.js";
import {MapOf} from "./types";
import {KeyConstructionData, KeyReDistributeData} from "./kdist.test.js";

/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const threshold = 2;
const allPartners = ["1","2","3","4"]
const random = () => Math.floor(Math.random()*9999999)

function resultOk(realKey: string|null, realPubKey: string|null, resultPubKey: string, reconstructedKey, reconstructedPubKey) {
  if(resultPubKey !== reconstructedPubKey)
    return false

  if(realKey) {
    return realKey === reconstructedKey && realPubKey === resultPubKey
  }

  return true
}

function checkSharesCorrectness(realPrivateKey, t, keyShares): string|undefined {
  keyShares = keyShares.filter(ks => !!ks);
  const realPubKey = realPrivateKey ? TssModule.keyFromPrivate(realPrivateKey).getPublic().encode("hex", true) : null;

  /** check total key reconstruction */
  const shares = keyShares
    .map(r => ({i: r.index, key: TssModule.keyFromPrivate(r.share)}))
  const reconstructedKey = bn2str(TssModule.reconstructKey(shares.slice(-t), t, 0))
  const reconstructedPubKey = TssModule.keyFromPrivate(reconstructedKey).getPublic().encode('hex', true)

  const pubKeyList = keyShares.map(key => key.publicKey)
  if(_.uniq(pubKeyList).length!==1)
    return `multiple publicKey ${_.uniq(pubKeyList).join(',')}`;

  const polynomialList = keyShares.map(k => k.polynomial.Fx.join(","))
  if(_.uniq(polynomialList).length!==1)
    return `multiple polynomial: ${polynomialList.length}`;

  if(!resultOk(realPrivateKey, realPubKey, keyShares[0].publicKey, reconstructedKey, reconstructedPubKey))
    return `result check failed`

  return undefined;
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
      (p, i) => keyGens[i]
        .runByNetwork(networks[i], 20000)
        .catch(e => null)
    )
  );

  return allNodeResults.map(r => !r ? null : r.toJson())
}

async function keyRedistribute(
  partners: string[],
  networks: FakeNetwork[],
  cData: KeyReDistributeData,
  shares: DistKeyJson[],
): Promise<DistKeyJson[]> {

  let keyReDistOpts: KeyReDistOpts = {
    id: cData.id,
    starter: cData.starter,
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
      (p, i) => keyReDists[i]
        .runByNetwork(networks[i], 20000)
        .catch(e => null)
    )
  );

  return allNodeResults.map(r => !r ? null : r.toJson())
}

async function run() {
  const fakeNets:MapOf<FakeNetwork> = allPartners.reduce((obj, id) => {
    /** Make node 2 response to the node 4 unstable. */
    obj[id]=new FakeNetwork(id, id==="2" ? ["4"] : [])
    return obj;
  }, {});

  const numReshare = 100;
  let numFailed = 0;
  const realPrivateKey = bn2str(toBN(1));

  let prevPartners = ["1","2","3"]
  let prevKeyShares = await keyGen(
    // partners
    prevPartners,
    // networks
    prevPartners.map(id => fakeNets[id]),
    // cData
    {
      id: `dkg-${Date.now()}${random()}`,
      starter: "1",
      partners: prevPartners,
      t: threshold,
      pk: realPrivateKey,
    }
  );
  if(!!checkSharesCorrectness(realPrivateKey, threshold, prevKeyShares))
    throw `key distribution failed`;

  const t1 = Date.now()
  for(let i=0 ; i<numReshare ; i++) {
    const startTime = Date.now();

    const resharePartners = ["1", "2", "3", "4",]
    // console.log({dealers, newPartners, partners, prevKeyShares})
    let keyShares = await keyRedistribute(
      resharePartners,
      resharePartners.map(id => fakeNets[id]),
      {
        id: `kredist-${Date.now()}${random()}`,
        starter: "1",
        partners: resharePartners,
        dealers: ["1", "2", "3"],
        publicKey: prevKeyShares[0].publicKey,
        previousPolynomial: prevKeyShares[0].polynomial!,
        t: threshold,
      },
      prevKeyShares,
    );
    // console.log({
    //   dealers,
    //   newPartners,
    //   shares: keyShares.map(k => !!k ? k.index : null)
    // });
    // console.log(keyShares)

    const errorReason = checkSharesCorrectness(realPrivateKey, threshold, keyShares)

    if(!errorReason)
      console.log(`i: ${i+1}/${numReshare}, match: OK, key party: ${keyShares[0].partners} time: ${Date.now() - startTime} ms`)
    else {
      numFailed++;
      console.log(`i: ${i+1}/${numReshare}, match: false reason: ${errorReason}`)
      // break;
    }
  }
  const t2 = Date.now()
  const dt = t2 - t1
  console.log(`  num failed: ${numFailed}`)
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
