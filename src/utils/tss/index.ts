import {PublicKey} from "./types";
import ethJsUtil from 'ethereumjs-util'
import {BN, toBN, keccak256, range, pub2addr} from './utils.js'
import assert from 'assert'
import elliptic from 'elliptic'

const EC = elliptic.ec;
const curve = new EC('secp256k1');
const HALF_N = curve.n!.shrn(1).addn(1);
/**
 * Let H be elements of G, such that nobody knows log, h
 * used for pedersen commitment
 * @type {Point}
 */
// const H = new Point(
//   '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
//   '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
// );
const H = curve.keyFromPublic("04206ae271fa934801b55f5144bec8416be0b85f22d452ad410f3f0fca1083dc7ae41249696c446f8c5b166760377115943662991c35ff02f9585f892970af89ed", 'hex').getPublic()

export function pointAdd(point1?: PublicKey, point2?: PublicKey): PublicKey {
  if (point1 === null)
    return point2!;
  if (point2 === null)
    return point1!;

  return point1!.add(point2!);
}

export function calcPoly(x, polynomial) {
  if (!BN.isBN(x))
    x = toBN(x);
  let result = toBN(0);
  for (let i = 0; i < polynomial.length; i++) {
    result = result.add(polynomial[i].mul(x.pow(toBN(i))));
  }
  return result.umod(curve.n!)
  // return result;
}

export function calcPolyPoint(x: string|number, polynomial: PublicKey[]): PublicKey {
  const bnx = toBN(x);
  const coeffs = polynomial.map((_,i) => bnx.pow(toBN(i)).umod(curve.n!))
  return curve.curve._endoWnafMulAdd(polynomial, coeffs, false);
}

export function random() {
  return curve.genKeyPair().getPrivate();
}

export function shareKey(privateKey, t, n, indices, polynomial) {
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
    assert(polynomial.length === t)
  else
    polynomial = [privateKey, ...(range(1, t).map(random))]
  return {
    polynomial: polynomial,
    shares: indices.map(i => {
      // TODO: key % n will prevent reconstructing of main key
      let privateKey = calcPoly(i, polynomial)//.umod(curve.n)
      // @ts-ignore
      return {i, key: curve.keyFromPrivate(privateKey)}
    })
  }
}

export function lagrangeCoef(j, t, shares, index) {
  let _x = BN.isBN(index) ? index : toBN(index);
  let prod = arr => arr.reduce((acc, current) => acc.mul(current), toBN(1));
  let x_j = toBN(shares[j].i)
  let arr = range(0, t).filter(k => k!==j).map(k => {
    let x_k = toBN(shares[k].i)
    // [numerator, denominator]
    return [_x.sub(x_k), x_j.sub(x_k)]
  });
  let numerator = prod(arr.map(a => a[0]))
  let denominator = prod(arr.map(a => a[1]))
  return numerator.mul(denominator.invm(curve.n));
}

export function reconstructKey(shares, t, index=0) {
  assert(shares.length >= t);
  let sum = toBN(0);
  for (let j = 0; j < t; j++) {
    let coef = lagrangeCoef(j, t, shares, index)
    let key = shares[j].key.getPrivate()
    sum = sum.add(key.mul(coef))
  }
  return sum.umod(curve.n!);
}

export function addKeys(key1, key2) {
  return key1.add(key2).umod(curve.n)
}

export function subKeys(key1, key2) {
  return key1.sub(key2).umod(curve.n)
}

export function keyFromPrivate(prv) {
  if(typeof prv === 'string')
    prv = prv.replace(/^0x/i, '')
  return curve.keyFromPrivate(prv)
}

export function keyFromPublic(pubKey:string|Uint8Array|Buffer|number[]|{x:string,y:string}, encoding='hex'): PublicKey {
  if(typeof pubKey === "string")
    return curve.keyFromPublic(pubKey.replace("0x", ""), 'hex').getPublic()
  else if(Array.isArray(pubKey) && typeof pubKey[0] === 'string' && typeof pubKey[1]==='string')
    return curve.keyFromPublic({x: pubKey[0], y: pubKey[1]}).getPublic()
  else
    return curve.keyFromPublic(pubKey, encoding).getPublic()
}

export function key2pub(privateKey) {
  let _PK = BN.isBN(privateKey) ? privateKey : toBN(privateKey)
  return curve.g.mul(_PK);
}

export function schnorrHash(publicKey, msg) {
  let address = pub2addr(publicKey)
  let addressBuff = Buffer.from(address.replace(/^0x/i, ''), 'hex');
  let msgBuff = Buffer.from(msg.replace(/^0x/i, ''), 'hex');
  let totalBuff = Buffer.concat([addressBuff, msgBuff])
  // @ts-ignore
  return keccak256(totalBuff)
}

export function schnorrSign(sharedPrivateKey, sharedK, kPub, msg) {
  let _sharedPrivateKey = BN.isBN(sharedPrivateKey) ? sharedPrivateKey : toBN(sharedPrivateKey);
  let e = toBN(schnorrHash(kPub, msg))
  let s = sharedK.sub(_sharedPrivateKey.mul(e)).umod(curve.n);
  return {s, e}
}

export function stringifySignature(sign: {s: BN, e: BN}): string {
  return `0x${sign.e.toString('hex' ,64)}${sign.s.toString('hex',64)}`
}

export function splitSignature(signature: string): {s: BN, e: BN} {
  const bytes = signature.replace('0x','');
  if(bytes.length !== 128)
    throw `invalid schnorr signature string`;
  return {
    e: toBN(`0x${bytes.substr(0, 64)}`),
    s: toBN(`0x${bytes.substr(64, 64)}`),
  }
}

export function schnorrVerify(pubKey: PublicKey, msg, sig:{s: BN, e: BN}|string) {
  if(typeof sig === 'string')
    sig = splitSignature(sig);
  if(!validatePublicKey(pubKey))
    return false
  const s = sig.s.umod(curve.n!)
  let r_v = pointAdd(curve.g.mul(s), pubKey.mul(sig.e))
  let e_v = schnorrHash(r_v, msg)
  return toBN(e_v).eq(sig.e);
}

export function schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey) {
  nonceAddress = nonceAddress.toLowerCase();
  const nonce = toBN(nonceAddress)
  hash = toBN(hash)
  signature = toBN(signature).umod(curve.n!);

  if(!validatePublicKey(signingPubKey))
    return false;

  if(nonce.isZero() || signature.isZero() || hash.isZero())
    return false

  // @ts-ignore
  const e = toBN(keccak256(Buffer.concat([
    nonce.toBuffer('be', 20),
    hash.toBuffer('be', 32)
  ])))

  let recoveredPubKey = ethJsUtil.ecrecover(
    curve.n!.sub(signingPubKey.getX().mul(signature).umod(curve.n)).toBuffer('be', 32),
    signingPubKey.getY().isEven() ? 27 : 28,
    signingPubKey.getX().toBuffer('be', 32),
    e.mul(signingPubKey.getX()).umod(curve.n!).toBuffer('be', 32)
  );
  const addrBuf = ethJsUtil.pubToAddress(recoveredPubKey);
  const addr    = ethJsUtil.bufferToHex(addrBuf);

  return nonceAddress === addr;
}

export function schnorrAggregateSigs(t, sigs, indices): {s: BN, e: BN}{
  assert(sigs.length >= t);
  let ts = toBN(0)
  range(0, t).map(j => {
    let coef = lagrangeCoef(j, t, indices.map(i => ({i})), 0);
    ts.iadd(sigs[j].s.mul(coef))
  })
  let s = ts.umod(curve.n!)
  let e = sigs[0].e.clone();
  return {s, e}
}

export function validatePublicKey(publicKey: PublicKey): boolean {
  return curve.curve.validate(publicKey);
}

export {
  curve,
  pub2addr,
  // use
  H,
  HALF_N,
}
