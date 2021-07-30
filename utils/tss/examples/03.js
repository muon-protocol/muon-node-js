/**
 * Run sign & verify process 200 times
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
let msg = 'hello tss'

for(let loop=0 ; loop<200 ; loop++) {
  /**
   * Generate random nonce
   */
  let k = tss.random();
  let kPub = tss.key2pub(k);
  let k_shares = tss.shareKey(k, t, n);

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
  let verified = tss.schnorrVerify(pubKey, msg, sig)

  console.log({loop, verified: verified})

  /**
   * if verify failed logs data
   */
  if(!verified){
    console.dir({
      shares: shares.map(({i, key,pub}) => ({
        i,
        key: key.toString(),
        pub: {x: pub.x.toString(), y: pub.y.toString()}
      })),
      k_shares: k_shares.map(({i, key,pub}) => ({
        i,
        key: key.toString(),
        pub: {x: pub.x.toString(), y: pub.y.toString()}
      })),
      sigs: sigs.map(({s,e}) => ({s:s.toString(), e:e.toString()})),
      sig: {s: sig.s.toString(), e: sig.e.toString()}
    }, {depth: null})
    break;
  }
}
console.log('finish.')


