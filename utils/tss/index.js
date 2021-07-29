const {BN, toBN, randomHex, sha3, range} = require('./utils')
const assert = require('assert')
const elliptic = require('elliptic');
const Point = require('./point');
const Curve = require('./curve');
const ZERO = toBN(0)
const ONE = toBN(1)
const TWO = toBN(2)
const THREE = toBN(3)


const curve = Curve.secp256k1;

/**
 Returns the inverse of k modulo p.
 This function returns the only integer x such that (x * k) % p == 1.
 k must be non-zero and p must be a prime.

 * @param k
 * @param p
 */
function inverseMod(k, p) {
  if(k.isZero())
    throw {message: 'division by zero'}

  // k ** -1 = p - (-k) ** -1  (mod p)
  if(k.isNeg())
    return p.sub(inverseMod(k.neg(), p))

  // Extended Euclidean algorithm.
  let [s, old_s] = [ZERO, ONE];
  let [t, old_t] = [ONE, ZERO];
  let [r, old_r] = [p, k]

  let quotient;
  while(!r.isZero()) {
    quotient = old_r.divmod(r).div;
    [old_r, r] = [r, old_r.sub(quotient.mul(r))];
    [old_s, s] = [s, old_s.sub(quotient.mul(s))];
  }

  let [gcd, x, y] = [old_r, old_s, old_t];

  // gcd == 1
  assert(gcd.eq(ONE))
  // (k * x) % p == 1
  assert(k.mul(x).umod(p).eq(ONE))

  // x % p
  return x.umod(p)
}

/**
 * Returns True if the given point lies on the elliptic curve.
 * @param point
 * @returns {boolean}
 */
function isOnCurve(point) {
  if (point === null) {
    // None represents the point at infinity.
    return true;
  }
  let {x, y} = point;
  // (y * y - x * x * x - curve.a * x - curve.b) % curve.p == 0
  return (y.pow(TWO).sub(x.pow(THREE)).sub(curve.a.mul(x)).sub(curve.b)).umod(curve.p).eq(ZERO)
}

/**
 * Returns -point.
 */
function pointNeg(point) {
  assert(isOnCurve(point))

  let {x, y} = point
  // (x, -y % curve.p)
  let result = new Point(x, y.neg().umod(curve.p))

  assert(isOnCurve(result))

  return result
}

function pointAdd(point1, point2){
  assert(isOnCurve(point1))
  assert(isOnCurve(point2))

  if(point1 === null)
    return point2;
  if(point2 === null)
    return point1;

  let {x:x1, y:y1} = point1;
  let {x:x2, y:y2} = point2;

  // point1 + (-point1) = 0
  if(x1.eq(x2) && !y1.eq(y2))
    return null

  let m;
  // This is the case point1 == point2.
  if(x1.eq(x2)) {
    // m = (3 * x1 * x1 + curve.a) * inverse_mod(2 * y1, curve.p)
    m = (THREE.mul(x1).mul(x1).add(curve.a)).mul(inverseMod(TWO.mul(y1), curve.p))
  }
  // This is the case point1 != point2.
  else {
    // m = (y1 - y2) * inverseMod(x1 - x2, curve.p)
    m = (y1.sub(y2)).mul(inverseMod(x1.sub(x2), curve.p))
  }

  let x3 = m.mul(m).sub(x1).sub(x2)
  let y3 = y1.add(m.mul(x3.sub(x1)))
  let result = new Point(x3.umod(curve.p), y3.neg().umod(curve.p))

  assert(isOnCurve(result))

  return result
}

/**
 * Returns k * point computed using the double and point_add algorithm.
 * @param k
 * @param point
 * @returns {*}
 */
function scalarMult(k, point){
  assert(isOnCurve(point))

  if(k.umod(curve.n).isZero() || point === null) //TODO
  // if(k.umod(curve.p).isZero() || point === null)
    return null

  // k * point = -k * (-point)
  if(k.lt(ZERO))
    return scalarMult(k.neg(), pointNeg(point))

  let result = null
  let addend = point

  while(!k.isZero()) {
    // k & 1 != 0
    if(!k.and(ONE).isZero()) {
      // Add.
      result = pointAdd(result, addend);
    }

    // Double.
    addend = pointAdd(addend, addend)

    k = k.shrn(1)
  }

  assert(isOnCurve(result))

  return result
}

function calcPoly(x, polynomial){
  if(!BN.isBN(x))
    x = toBN(x);
  let result = toBN(0);
  for(let i=0 ; i<polynomial.length ; i++){
    result = result.add(polynomial[i].mul(x.pow(toBN(i))));
  }
  return result.umod(curve.n)
}

function makeRandomNum() {
  let byteSize = curve.n.bitLength() / 8
  let rand = randomHex(byteSize)
  return toBN(rand).umod(curve.n);
}

function shareKey(privateKey, t, n){
  let poly = [privateKey , ...(range(1, t).map(makeRandomNum))]
  return range(1, n+1).map(i => {
    let key = calcPoly(i, poly)
    let pub = key2pub(key);
    return{i, key, pub}
  })
}

function lagrangeCoef(j, t, shares) {
  let prod = arr => arr.reduce((acc, current) => (current*acc) ,1);
  let arr = range(0, t).map(k => {
    return j===k ? 1 : (-shares[k].i/(shares[j].i - shares[k].i))
  });
  return parseInt(prod(arr));
}

function reconstructKey(shares, t){
  assert(shares.length >= t);
  let sum = toBN(0);
  for(let j=0 ; j<t ; j++){
    let coef = lagrangeCoef(j, t, shares)
    sum.iadd(shares[j].key.mul(toBN(coef)))
  }
  return sum.umod(curve.n);
}

function reconstructPubKey(shares, t){
  assert(shares.length >= t);
  let pub = null
  range(0, t).map(j => {
    let coef = toBN(lagrangeCoef(j, t, shares));
    pub = pointAdd(pub, scalarMult(coef, shares[j].pub))
  })
  return pub;
}

function key2pub(privateKey) {
  return scalarMult(privateKey, curve.g);
}

function pub2addr(publicKey) {
  let {x, y} = publicKey
  let mix = '0x' + x.shln(y.byteLength()*8).or(y).toString(16);
  let pub_hash = sha3(mix)
  return toChecksumAddress('0x' + pub_hash.substr(-40));
}

function makeKeyPair(){
  let privateKey = makeRandomNum();
  return {
    privateKey,
    publicKey: key2pub(privateKey)
  }
}

function toChecksumAddress (address) {
  address = address.toLowerCase().replace(/^0x/i, '')
  let hash = sha3(address).replace(/^0x/i, '');
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

function schnorrHash(publicKey, msg){
  let {x, y} = publicKey
  let pubKeyBuff = x.shln(y.byteLength() * 8).or(y).toBuffer();
  let msgBuff = Buffer.from(msg)
  let buffToHash = Buffer.concat([pubKeyBuff, msgBuff])
  return sha3(buffToHash)
}

function schnorrSign(sharedPrivateKey, sharedK, kPub, msg){
  let e = toBN(schnorrHash(kPub, msg))
  let s = sharedK.sub(sharedPrivateKey.mul(e)).umod(curve.n);
  return {s, e}
}

function schnorrVerify(pubKey, msg, sig){
  let r_v = pointAdd(scalarMult(sig.s, curve.g), scalarMult(sig.e, pubKey))
  let e_v = schnorrHash(r_v, msg)
  return e_v === '0x'+sig.e.toString(16)
}

module.exports = {
  curve,
  makeRandomNum,
  shareKey,
  lagrangeCoef,
  reconstructKey,
  reconstructPubKey,
  toBN,
  key2pub,
  pub2addr,
  schnorrHash,
  schnorrSign,
  schnorrVerify,
}
