const {BN, toBN, randomHex, sha3, soliditySha3, range} = require('./utils')
const assert = require('assert')
const elliptic = require('elliptic');
const BigNumber = require('bignumber.js')
BigNumber.set({DECIMAL_PLACES: 300})
const Point = require('./point');
const Curve = require('./curve');
const ZERO = toBN(0)
const ONE = toBN(1)
const TWO = toBN(2)
const THREE = toBN(3)


const curve = Curve.secp256k1;
/**
 * Let H be elements of G, such that nobody knows log, h
 * used for pedersen commitment
 * @type {Point}
 */
const H = new Point(
  '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
);

/**
 Returns the inverse of k modulo p.
 This function returns the only integer x such that (x * k) % p == 1.
 k must be non-zero and p must be a prime.

 * @param k
 * @param p
 */
function inverseMod(k, p) {
  if (k.isZero())
    throw {message: 'division by zero'}

  // k ** -1 = p - (-k) ** -1  (mod p)
  if (k.isNeg())
    return p.sub(inverseMod(k.neg(), p))

  // Extended Euclidean algorithm.
  let [s, old_s] = [ZERO, ONE];
  let [t, old_t] = [ONE, ZERO];
  let [r, old_r] = [p, k]

  let quotient;
  while (!r.isZero()) {
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
  let result = new Point(x.clone(), y.neg().umod(curve.p))

  assert(isOnCurve(result))

  return result
}

function pointAdd(point1, point2) {
  if (point1 === null)
    return point2;
  if (point2 === null)
    return point1;

  assert(isOnCurve(point1))
  assert(isOnCurve(point2))

  let {x: x1, y: y1} = point1;
  let {x: x2, y: y2} = point2;

  // point1 + (-point1) = 0
  if (x1.eq(x2) && !y1.eq(y2))
    return null

  let m;
  // This is the case point1 == point2.
  if (x1.eq(x2)) {
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
function scalarMult(k, point) {
  assert(isOnCurve(point))
  k = k.clone();

  if (k.umod(curve.n).isZero() || point === null) //TODO
  // if(k.umod(curve.p).isZero() || point === null)
    return null

  // k * point = -k * (-point)
  if (k.lt(ZERO))
    return scalarMult(k.neg(), pointNeg(point))

  let result = null
  let addend = point

  while (!k.isZero()) {
    // k & 1 != 0
    if (!k.and(ONE).isZero()) {
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

function calcPoly(x, polynomial) {
  if (!BN.isBN(x))
    x = toBN(x);
  let result = toBN(0);
  for (let i = 0; i < polynomial.length; i++) {
    result = result.add(polynomial[i].mul(x.pow(toBN(i))));
  }
  return result.umod(curve.n)
  // return result;
}

function calcPolyPoint(x, polynomial) {
  if (!BN.isBN(x))
    x = toBN(x);
  let result = null;
  for (let i = 0; i < polynomial.length; i++) {
    result = pointAdd(result, scalarMult(x.pow(toBN(i)), polynomial[i]));
  }
  return result;
}

function random() {
  return curve.random();
}

function shareKey(privateKey, t, n, indices, polynomial) {
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
      let key = calcPoly(i, polynomial)//.umod(curve.n)
      let pub = key2pub(key);
      return {i, key, pub}
    })
  }
}

// function lagrangeCoef(j, t, shares) {
//   // slower but less division rounding error propagation
//   let prod = arr => arr.reduce((acc, current) => acc.multipliedBy(current), new BigNumber(1));
//   let x_j = new BigNumber(shares[j].i)
//   let arr = range(0, t).filter(k => k!==j).map(k => {
//     let x_k = new BigNumber(shares[k].i)
//     // [numerator, denominator]
//     return [x_k.negated(), x_j.minus(x_k)]
//   });
//   let numerator = prod(arr.map(a => a[0]))
//   let denominator = prod(arr.map(a => a[1]))
//   return numerator.div(denominator);
// }

function lagrangeCoef(j, t, shares) {
  // faster but more error propagation
  let prod = arr => arr.reduce((acc, current) => acc.multipliedBy(current), new BigNumber(1));
  let x_j = new BigNumber(shares[j].i)
  let arr = range(0, t).filter(k => k!==j).map(k => {
    let x_k = new BigNumber(shares[k].i)
    return x_k.negated().div(x_j.minus(x_k))
  });
  return prod(arr);
}

function reconstructKey(shares, t) {
  assert(shares.length >= t);
  let sum = new BigNumber(0);
  for (let j = 0; j < t; j++) {
    let coef = lagrangeCoef(j, t, shares)
    let key = new BigNumber(shares[j].key.toString())
    sum = sum.plus(key.multipliedBy(coef))
  }
  sum = toBN('0x'+sum.integerValue().toString(16))
  return sum.umod(curve.n);
}

function key2pub(privateKey) {
  let _PK = BN.isBN(privateKey) ? privateKey : toBN(privateKey)
  return scalarMult(_PK, curve.g);
}

function pub2addr(publicKey) {
  let {x, y} = publicKey
  let mix = x.shln(256).or(y)
  let pub_hash = soliditySha3(mix.toBuffer())
  return toChecksumAddress('0x' + pub_hash.substr(-40));
}


function makeKeyPair() {
  let privateKey = random();
  return {
    privateKey,
    publicKey: key2pub(privateKey)
  }
}

function toChecksumAddress(address) {
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

function schnorrHash(publicKey, msg) {
  let {x, y} = publicKey
  let pubKeyBuff = x.shln(256).or(y).toBuffer();
  let msgBuff = Buffer.from(msg)
  let buffToHash = Buffer.concat([pubKeyBuff, msgBuff])
  return sha3(buffToHash)
}

function schnorrSign(sharedPrivateKey, sharedK, kPub, msg) {
  let _sharedPrivateKey = BN.isBN(sharedPrivateKey) ? sharedPrivateKey : toBN(sharedPrivateKey);
  let e = toBN(schnorrHash(kPub, msg))
  let s = sharedK.sub(_sharedPrivateKey.mul(e));
  return {s, e}
}

function schnorrVerify(pubKey, msg, sig) {
  let r_v = pointAdd(scalarMult(sig.s, curve.g), scalarMult(sig.e, pubKey))
  let e_v = schnorrHash(r_v, msg)
  let verified = toBN(e_v).eq(sig.e)
  // if(!verified){
  //   console.log(`r_v`, r_v.serialize());
  // }
  return verified;
}

function schnorrAggregateSigs(t, sigs, indices){
  assert(sigs.length >= t);

  let ts = new BigNumber(0)
  range(0, t).map(j => {
    let coef = lagrangeCoef(j, t, indices.map(i => ({i})));
    let s = new BigNumber(sigs[j].s.toString())
    ts = ts.plus(s.multipliedBy(coef))
  })
  // TODO: is "s % n" needed?
  let s = toBN('0x' + ts.integerValue().toString(16)).umod(curve.n)
  let e = sigs[0].e.clone();
  return {s, e}
}

module.exports = {
  curve,
  random,
  pointAdd,
  scalarMult,
  calcPoly,
  calcPolyPoint,
  shareKey,
  lagrangeCoef,
  reconstructKey,
  toBN,
  key2pub,
  pub2addr,
  schnorrHash,
  schnorrSign,
  schnorrVerify,
  schnorrAggregateSigs,
  // use
  H
}
