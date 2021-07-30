/**
 * Generate private key, share it and reconstruct it again.
 */

const {toBN, range} = require('../utils')
const tss = require('../index')

const t = 3, n=5;

privateKey = tss.random();
pubKey = tss.key2pub(privateKey)
address = tss.pub2addr(pubKey)


let shares = tss.shareKey(privateKey, t, n)
let reconstructed = tss.reconstructKey(shares, t);
let recAddr = tss.pub2addr(tss.reconstructPubKey(shares, t))

console.log(`         Original Key: ${privateKey.toString(16)}`)
console.log(`    Reconstructed Key: ${reconstructed.toString(16)}`);
console.log(`     Original Address: ${address}`);
console.log(`Reconstructed Address: ${recAddr}`);


