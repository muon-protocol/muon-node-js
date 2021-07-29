const {toBN, range} = require('./utils')
const tss = require('./index')

const t = 3, n=5;

privateKey = tss.makeRandomNum();
pubKey = tss.getPublicKey(privateKey)
address = tss.pub2addr(pubKey)


console.log(`PK: ${privateKey.toString(16)}`)
let shares = tss.shareKey(privateKey, t, n)
// console.log(shares.map(s => ({...s, key: s.key.toString(16)})))
// console.log(shares.map(s => s.key.toString(16)))

let reconstructed = tss.reconstructKey(shares, t);
console.log(`RK: ${reconstructed.toString(16)}`);

let k = tss.makeRandomNum();
let kPub = tss.getPublicKey(k);
let k_shares = tss.shareKey(k, t, n);

let msg = 'hello tss'
let sigs = range(0, t).map(i => tss.schnorrSign(shares[i].key, k_shares[i].key, kPub, msg))

let ts = toBN(0)
range(0, sigs.length).map(j => {
  let coef = tss.lagrangeCoef(j, t, k_shares);
  ts = ts.add(sigs[j].s.mul(toBN(coef)))
})
ts = ts.umod(tss.curve.n)
let sig = {s:ts, e:sigs[0].e}

console.log({verified: tss.schnorrVerify(pubKey, msg, sig)})


