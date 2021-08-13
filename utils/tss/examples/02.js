/**
 * Sign message using schnorr signature and verify signature.
 */

const {toBN, range} = require('../utils')
const tss = require('../index')
const BigNumber = require('bignumber.js')


/**
 * Share privateKey between 5 individuals
 * Needs to at least 3 individual's signature to recover global signature
 */
const t = 3, n=5;

/**
 * 1) Generate random privateKey
 */
privateKey = tss.random();
pubKey = tss.key2pub(privateKey)
address = tss.pub2addr(pubKey)

/**
 * Share private key
 */
let shares = tss.shareKey(privateKey, t, n, [1,6,7,12,20])
// let shares = tss.shareKey(privateKey, t, n, [1,2,3,4,5])

/**
 * Generate random nonce
 */
let k = tss.random();
let kPub = tss.key2pub(k);
let k_shares = tss.shareKey(k, t, n, shares.map(s => s.i));

let msg = 'hello tss'

/**
 * Sign message
 */
let sigs = range(0, t).map(i => tss.schnorrSign(shares[i].key, k_shares[i].key, kPub, msg))

console.log(`z share indices: `, shares.map(s => s.i))
console.log(`k share indices: `, k_shares.map(s => s.i))

/**
 * Aggregate signatures
 */
let ts = new BigNumber(0)
range(0, sigs.length).map(j => {
  // verify step 1
  // console.log('check verification for ' + tss.pub2addr(shares[j].pub))
  let SiG = tss.scalarMult(sigs[j].s, tss.curve.g)
  let Ki_Zie = tss.pointAdd(k_shares[j].pub, tss.scalarMult(sigs[j].e.neg(), shares[j].pub))
  console.log(`sigs[${j}] verified: ${SiG.serialize() === Ki_Zie.serialize()}`)

  let coef = tss.lagrangeCoef(j, t, k_shares);
  // console.log({coef: coef.toString()})
  let s = new BigNumber(sigs[j].s.toString())
  ts = ts.plus(s.multipliedBy(coef))
  // console.log({coef: coef.toString(), s: sigs[j].s.toString(), ts: ts.toString()})
})
// console.log(`ts: ${ts.integerValue()}`)
ts = toBN(ts.integerValue().toString(16)).umod(tss.curve.n)
let sig = {s:ts, e:sigs[0].e}

/**
 * Verify signatures
 */
console.log('  K: ' + kPub.serialize())
console.log(`verified: ${tss.schnorrVerify(pubKey, msg, sig)}`)


