import ethJsUtil from 'ethereumjs-util'
import * as noble from "@noble/secp256k1"
import {bigint2buffer, bigint2hex, buf2bigint, hex2buffer, keccak256, range} from './utils.js'
import assert from 'assert'
import Polynomial from './polynomial.js'

const curve = noble.CURVE
const HALF_N = (noble.CURVE.n >> 1n) + 1n;
// /**
//  * Let H be elements of G, such that nobody knows log, h
//  * used for pedersen commitment
//  * @type {Point}
//  */
const H: noble.Point = new noble.Point(
  BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
  BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8')
);

function pointAdd(point1: noble.Point | null | undefined, point2: noble.Point | null | undefined): noble.Point {
  if (!point1) {
    if(!point2)
      throw `Two null point cannot be added.`
    return point2;
  }
  if (!point2) {
    return point1;
  }

  return point1.add(point2);
}

function calcPolyPoint(x: bigint | string, polynomial: noble.Point[]): noble.Point {
  if (typeof x !== 'bigint')
    x = BigInt(x);
  let result: any = null;
  for (let i = 0; i < polynomial.length; i++) {
    result = pointAdd(result, polynomial[i].multiply(x ** BigInt(i)));
  }
  return result;
}

function random():bigint {
  return buf2bigint(noble.utils.randomPrivateKey());
}

function shareKey(privateKey: bigint, t, n, indices, polynomial: Polynomial) {
  if(indices){
    assert(indices.length === n)
  }
  else{
    // uniform distribution of indices
    indices = range(1, n + 1)
    // non uniform distribution of indices
    // indices = range(1, n + 1).map(i => i * 10 + Math.floor(Math.random() * 9))
  }
  if(polynomial)
    assert(polynomial.t === t)
  else
    polynomial = new Polynomial(t, null, privateKey);
  return {
    polynomial: polynomial,
    shares: indices.map(i => {
      // TODO: key % n will prevent reconstructing of main key
      let privateKey = polynomial.calc(BigInt(i))
      return {i, key: privateKey}
    })
  }
}

function lagrangeCoef(j, t, shares, index: bigint): bigint {
  let _x = index;
  let prod = arr => arr.reduce((acc, current) => (acc * current), 1n);
  let x_j = BigInt(shares[j].i)
  let arr = range(0, t).filter(k => k!=j).map(k => {
    let x_k = BigInt(shares[k].i)
    // [numerator, denominator]
    return [_x - x_k, x_j - x_k]
  });
  let numerator = prod(arr.map(a => a[0]))
  let denominator = prod(arr.map(a => a[1]))
  return numerator * noble.utils.invert(denominator, noble.CURVE.n);
}

function reconstructKey(shares, t, index=0n) {
  assert(shares.length >= t);
  let sum = 0n;
  for (let j = 0; j < t; j++) {
    let coef = lagrangeCoef(j, t, shares, index)
    let key = shares[j].key
    sum += key * coef
  }
  return noble.utils.mod(sum, noble.CURVE.n);
}

function addKeys(key1: bigint, key2: bigint) {
  return noble.utils.mod(key1 + key2, noble.CURVE.n)
}

function subKeys(key1: bigint, key2: bigint) {
  return noble.utils.mod(key1- key2, noble.CURVE.n)
}

function pub2addr(publicKey: noble.Point) {
  let pubKeyHex = publicKey.toHex(false).substr(2);
  // @ts-ignore
  let pub_hash = keccak256(hex2buffer(pubKeyHex))
  return toChecksumAddress('0x' + pub_hash.substr(-40));
}

function invert(num: bigint): bigint {
  return noble.utils.invert(num, curve.n);
}

function mod(num: bigint): bigint {
  return noble.utils.mod(num, curve.n);
}

function toChecksumAddress(address) {
  address = address.toLowerCase().replace(/^0x/i, '')
  let hash = keccak256(address).replace(/^0x/i, '');
  let ret = '0x'
  for (let i = 0; i < address.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      ret += address[i].toUpperCase()
    } else {
      ret += address[i]
    }
  }
  return ret
}

function schnorrHash(publicKey: noble.Point, msg) {
  let address = pub2addr(publicKey)
  const concated = bigint2hex(BigInt(address)<<256n | BigInt(msg), 52)
  // @ts-ignore
  return keccak256(hex2buffer(concated));
}

function schnorrSign(sharedPrivateKey: bigint, sharedK: bigint, kPub: noble.Point, msg): {s: bigint, e: bigint} {
  let e = BigInt(schnorrHash(kPub, msg))
  let s = noble.utils.mod(sharedK - (sharedPrivateKey * e), curve.n);
  return {s, e}
}

const G = new noble.Point(noble.CURVE.Gx, noble.CURVE.Gy);
Object.freeze(G);

function schnorrVerify(pubKey: noble.Point, msg: string, sig: {s: string, e:string}) {
  let r_v = pointAdd(G.multiply(BigInt(sig.s)), pubKey.multiply(BigInt(sig.e)))
  let e_v = schnorrHash(r_v, msg)
  if(BigInt(e_v) !== BigInt(sig.e)) {
    console.log({
      msg,
      pubKey: pubKey.toHex(),
      rv: r_v.toHex(),
      e_v: e_v,
      e: sig.e
    })
  }
  return BigInt(e_v) == BigInt(sig.e);
}

function schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey: noble.Point) {
  nonceAddress = nonceAddress.toLowerCase();
  const _nonce: bigint = BigInt(nonceAddress)
  const _hash: bigint = BigInt(hash)
  const _signature: bigint = BigInt(signature)

  if(_signature >= curve.n)
    throw "signature must be reduced modulo N"

  if(_nonce===0n || _signature===0n || _hash===0n)
    throw `no zero inputs allowed`

  // @ts-ignore
  const e: bigint = BigInt(keccak256(bigint2buffer(_nonce << 256n | _hash, 52)))

  let recoveredPubKey = ethJsUtil.ecrecover(
    bigint2buffer(curve.n - noble.utils.mod(signingPubKey.x * _signature, curve.n)),
    ((signingPubKey.y & 1n) === 0n) ? 27 : 28,
    bigint2buffer(signingPubKey.x),
    bigint2buffer(noble.utils.mod(e * signingPubKey.x, curve.n))
  );
  const addrBuf = ethJsUtil.pubToAddress(recoveredPubKey);
  const addr    = ethJsUtil.bufferToHex(addrBuf);

  return nonceAddress === addr;
}

function schnorrAggregateSigs(t, sigs, indices): {s: string, e: string}{
  assert(sigs.length >= t);
  let ts = 0n;
  range(0, t).map(j => {
    let coef = lagrangeCoef(j, t, indices.map(i => ({i})), 0n);
    ts += BigInt(sigs[j].s) * coef
  })
  let s = noble.utils.mod(ts, curve.n)
  let e = sigs[0].e;
  return {s: bigint2hex(s), e}
}

function keyFromPrivate(key: string): bigint {
  return BigInt(key);
}

function keyFromPublic(key: string|{x:bigint, y:bigint}): noble.Point {
  if(typeof key === 'string')
    return noble.Point.fromHex(key);
  else
    return new noble.Point(key.x, key.y);
}

function sumMod(arr: bigint[], modulo?: bigint) {
  const sum = arr.reduce((sum, val) => (sum + val), 0n);
  return noble.utils.mod(sum, modulo);
}

export {
  curve,
  random,
  invert,
  mod,
  sumMod,
  pointAdd,
  keyFromPrivate,
  keyFromPublic,
  calcPolyPoint,
  shareKey,
  lagrangeCoef,
  reconstructKey,
  addKeys,
  subKeys,
  pub2addr,
  schnorrHash,
  schnorrSign,
  schnorrVerify,
  schnorrVerifyWithNonceAddress,
  schnorrAggregateSigs,
  // use
  G,
  H,
  HALF_N,
}
