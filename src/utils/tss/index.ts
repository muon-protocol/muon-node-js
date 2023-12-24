import {PublicKey, PublicKeyShare} from "./types";
import ethJsUtil from 'ethereumjs-util'
import {BN, toBN, keccak256, range, pub2addr, bn2hex} from './utils.js'
import assert from 'assert'
import elliptic from 'elliptic'
import { muonSha3 } from "../sha3.js";
import { DistNonceCommitment } from "../../common/mpc/dist-nonce";
import { MapOf } from "../../common/mpc/types";

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
  if (!point1)
    return point2!;
  if (!point2)
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
  let arr = range(0, shares.length).filter(k => k!==j).map(k => {
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

export function reconstructPubKey(shares: PublicKeyShare[], t, index=0): PublicKey {
  assert(shares.length >= t);
  let sum: PublicKey|undefined = undefined;
  for (let j = 0; j < t; j++) {
    let coef = lagrangeCoef(j, t, shares, index)
    let pubKey:PublicKey = shares[j].publicKey
    sum = pointAdd(sum, pubKey.mul(coef))
  }
  // @ts-ignore
  return sum;
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

export function schnorrHash(signingPublicKey: PublicKey, nonceTimesGeneratorAddress, msg) {
  let totalBuff = Buffer.concat([
    /** signingPubKeyX */
    signingPublicKey.getX().toBuffer('be', 32),
    /** pubKeyYParity */
    Buffer.from(signingPublicKey.getY().isEven() ? "00" : "01", "hex"),
    /** msg hash */
    Buffer.from(msg.replace(/^0x/i, ''), 'hex'),
    /** nonceGeneratorAddress */
    Buffer.from(nonceTimesGeneratorAddress.replace(/^0x/i, ''), 'hex'),
  ])
  // @ts-ignore
  return keccak256(totalBuff)
}

export function schnorrSign(signingShare:BN|string, signingPubKey:PublicKey, nonceShare:BN|string, noncePublicKey:PublicKey, msg) {
  let _signingShare = BN.isBN(signingShare) ? signingShare : toBN(signingShare);
  let _nonceShare = BN.isBN(nonceShare) ? nonceShare : toBN(nonceShare);
  let nonceTimesGeneratorAddress = pub2addr(noncePublicKey)
  let e = toBN(schnorrHash(signingPubKey, nonceTimesGeneratorAddress, msg))
  let s = _nonceShare.sub(_signingShare.mul(e)).umod(curve.n);
  return {s, e}
}

export function schnorrVerify(signingPublicKey: PublicKey, msg, sig:{s: BN, e: BN}|string) {
  if(typeof sig === 'string')
    sig = splitSignature(sig) as SchnorrSign;
  if(!validatePublicKey(signingPublicKey))
    return false
  const s = sig.s.umod(curve.n!)
  let r_v = pointAdd(curve.g.mul(s), signingPublicKey.mul(sig.e))
  let nonceTimesGeneratorAddress = pub2addr(r_v)
  let e_v = schnorrHash(signingPublicKey, nonceTimesGeneratorAddress, msg)
  return toBN(e_v).eq(sig.e);
}

export function schnorrVerifyPartial(
  /** key share public */
  partialPubKey: PublicKey,
  /** key public */
  pubKey: PublicKey,
  /** nonce share public */
  partialNoncePubKey: PublicKey,
  /** nonce public */
  noncePubKey: PublicKey,
  /** message */
  msg,
  /** signature */
  sig:{s: BN, e: BN}|string
) {
  if(typeof sig === 'string')
    sig = splitSignature(sig) as SchnorrSign;
  if(
    !validatePublicKey(partialPubKey)
    || !validatePublicKey(pubKey)
    || !validatePublicKey(partialNoncePubKey)
    || !validatePublicKey(noncePubKey)
  )
    return false

  let nonceTimesGeneratorAddress = pub2addr(noncePubKey)
  let e = toBN(schnorrHash(pubKey, nonceTimesGeneratorAddress, msg))

  const s = sig.s.umod(curve.n!)
  let r_v = pointAdd(curve.g.mul(s), partialPubKey.mul(e))
  return e.eq(sig.e) && r_v.eq(partialNoncePubKey);
}

export function schnorrVerifyWithNonceAddress(hash, signature, nonceAddress, signingPubKey) {
  nonceAddress = nonceAddress.toLowerCase();
  signature = toBN(signature).umod(curve.n!);

  if(!validatePublicKey(signingPubKey))
    return false;

  if(toBN(nonceAddress).isZero() || signature.isZero() || toBN(hash).isZero())
    return false

  // @ts-ignore
  const e = toBN(schnorrHash(signingPubKey, nonceAddress, hash))

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

export function frostH1(id: string|number, msg: string, B: {i: string|number, D: PublicKey, E: PublicKey}[]): string {
  return muonSha3(
      {t: "uint32", v: id},
      {t: "uint256", v: msg},
      ...B.map(({i}) => ({t: "uint32", v: i})),
      ...B.map(({D}) => ({t: "byte[]", v: D.encode("hex", true)})),
      ...B.map(({E}) => ({t: "byte[]", v: E.encode("hex", true)}))
  )
}

export function frostSignInit(
  msg: string,
  Y: PublicKey, 
  partners: string[],
  commitments: MapOf<DistNonceCommitment>,
) {
  const B = partners.map(id => ({
    i: parseInt(id), 
    ...commitments[id]
  }));
  const rho: BN[] = partners.map((id, i) => toBN(frostH1(i, msg, B)));
  const Ri = partners.map((id, i) => {
    const {D, E} = B[i];
    const DE = pointAdd(D, E.mul(rho[i]));
    return DE;
  })
  const R:PublicKey = Ri.reduce((res: undefined|PublicKey, r): PublicKey => {
    return pointAdd(res, r)
  }, undefined)!;
  const c:BN = toBN(schnorrHash(Y, pub2addr(R), msg));
  return {R, Ri, rho, c}
}

export function frostSign(
  msg: string,
  secret: {share: BN, pubKey: PublicKey}, 
  nonce: {d: BN, e: BN}, 
  partners: string[],
  partnerIndex: number,
  commitments: MapOf<DistNonceCommitment>,
): {R: PublicKey, s: BN} {
  const {R, rho, c} = frostSignInit(msg, secret.pubKey, partners, commitments);
  const iList = partners.map(id => ({i: parseInt(id)}));
  const lambda:BN = lagrangeCoef(partnerIndex, -1, iList, "0");
  const s = nonce.d
    .add(nonce.e.mul(rho[partnerIndex]))
    .sub(lambda.mul(secret.share).mul(c))
    .umod(curve.n!)

  return {R, s};
}

export function frostVerify(sign: FrostSign, Y: PublicKey, msg: string): boolean {
  const e = schnorrHash(Y, pub2addr(sign.R), msg);
  const p1 = curve.g.mul(sign.s);
  const p2 = p1.add(Y.mul(toBN(e))).encode("hex", true);
  return sign.R.encode("hex", true) == p2;
}

export function frostVerifyPartial(
  sign: FrostSign, 
  Y: PublicKey, 
  Yi: PublicKey,
  partners: string[],
  i: number,
  commitments: MapOf<DistNonceCommitment>, 
  msg: string
): boolean {
  const {Ri, c} = frostSignInit(
    msg,
    Y,
    partners,
    commitments
  )
  const lambda = lagrangeCoef(i, -1, partners.map(id => ({i: parseInt(id)})), "0");
  const Ylc = Yi.mul(c).mul(lambda);
  const p1 = curve.g.mul(sign.s).add(Ylc);
  return p1.encode("hex", true) === Ri[i].encode("hex", true);
}

export function stringifySignature(sign: {s: BN, e: BN}|{R: PublicKey, s: BN}): string {
  // @ts-ignore
  if(!!sign.e)
    // @ts-ignore
    return `0x${sign.e.toString('hex' ,64)}${sign.s.toString('hex',64)}`
  else
    // @ts-ignore
    return `0x${sign.R.encode('hex' ,true).replace("0x", "")}${sign.s.toString('hex',64)}`
}

export function splitSignature(signature: string): {s: BN, e: BN} | {R: PublicKey, s: BN} {
  const bytes = signature.replace('0x','');
  const numBytes = bytes.length >> 1;
  switch (numBytes) {
    case 64: return {
      e: toBN(`0x${bytes.substr(0, 64)}`),
      s: toBN(`0x${bytes.substr(64, 64)}`),
    };
    case 65: {
      return {
        R: keyFromPublic(`0x${bytes.substr(0, 66)}`),
        s: toBN(`0x${bytes.substr(66, 64)}`),
      }
    };
    default: 
      throw {message: `invalid schnorr signature string`, signature: signature};

  }
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

export type SchnorrSign = {s: BN, e: BN};
export type FrostSign = {R: PublicKey, s: BN};

export function frostAggregateSigs(sigs: {R: PublicKey, s: BN}[]): FrostSign {
  return {
    R: sigs[0].R,
    s: sigs.reduce((sum: BN, {s}) => (sum.iadd(s), sum), toBN("0")).umod(curve.n!)
  }
}

export function validatePublicKey(publicKey: string|PublicKey): boolean {
  if(typeof publicKey === 'string')
    publicKey = keyFromPublic(publicKey);
  return curve.curve.validate(publicKey);
}

export {
  curve,
  pub2addr,
  // use
  H,
  HALF_N,
}
