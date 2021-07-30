/**
 * Sign message using schnorr signature and verify signature.
 */

const {toBN, range} = require('../utils')
const tss = require('../index')


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
let shares = tss.shareKey(privateKey, t, n)

/**
 * Generate random nonce
 */
let k = tss.random();
let kPub = tss.key2pub(k);
let k_shares = tss.shareKey(k, t, n);

let msg = 'hello tss'

/**
 * Sign message
 */
let sigs = range(0, t).map(i => tss.schnorrSign(shares[i].key, k_shares[i].key, kPub, msg))

/**
 * Aggregate signatures
 */
let ts = toBN(0)
range(0, sigs.length).map(j => {
  let coef = tss.lagrangeCoef(j, t, k_shares);
  ts = ts.add(sigs[j].s.mul(toBN(coef)))
})
ts = ts.umod(tss.curve.n)
let sig = {s:ts, e:sigs[0].e}

/**
 * Verify signatures
 */
console.log(`verified: ${tss.schnorrVerify(pubKey, msg, sig)}`)


