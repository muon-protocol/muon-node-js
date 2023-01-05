import * as noble from "@noble/secp256k1"
import {buf2bigint, keccak256, range} from './utils.js'
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
  let pub_hash = keccak256(pubKeyHex)
  return toChecksumAddress('0x' + pub_hash.substr(-40));
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
  let addressBuff = Buffer.from(address.replace(/^0x/i, ''), 'hex');
  let msgBuff = Buffer.from(msg.replace(/^0x/i, ''), 'hex');
  let totalBuff = Buffer.concat([addressBuff, msgBuff])
  return keccak256(totalBuff.toString())
}

function schnorrSign(sharedPrivateKey: bigint, sharedK: bigint, kPub: noble.Point, msg) {
  let e = BigInt(schnorrHash(kPub, msg))
  let s = noble.utils.mod(sharedK - (sharedPrivateKey * e), noble.CURVE.n);
  return {s, e}
}

const G = new noble.Point(noble.CURVE.Gx, noble.CURVE.Gy);
Object.freeze(G);

function schnorrVerify(pubKey: noble.Point, msg: string, sig: {s: bigint, e:bigint}) {
  let r_v = pointAdd(G.multiply(sig.s), pubKey.multiply(sig.e))
  let e_v = schnorrHash(r_v, msg)
  if(BigInt(e_v) !== sig.e) {
    console.log({
      msg,
      pubKey: pubKey.toHex(),
      rv: r_v.toHex(),
      e_v: e_v,
      e: sig.e.toString(16)
    })
  }
  return BigInt(e_v) == sig.e;
}

function schnorrAggregateSigs(t, sigs, indices){
  assert(sigs.length >= t);
  let ts = 0n;
  range(0, t).map(j => {
    let coef = lagrangeCoef(j, t, indices.map(i => ({i})), 0n);
    ts += sigs[j].s * coef
  })
  let s = noble.utils.mod(ts, noble.CURVE.n)
  let e = sigs[0].e;
  return {s, e}
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
  schnorrAggregateSigs,
  // use
  G,
  H,
  HALF_N,
}
