const {BN, toBN, randomHex} = require('./utils')
const elliptic = require('elliptic');
const Point = require('./point');
const Curve = require('./curve');
const ZERO = new BN(0)
const ONE = new BN(1)
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
    quotient = old_r.divRound(r);
    [old_r, r] = [r, old_r.sub(quotient.mul(r))];
    [old_s, s] = [s, old_s.sub(quotient.mul(s))];
    [old_t, t] = [t, old_t.sub(quotient.mul(t))];
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

  let {x, y} = this
  // (x, -y % curve.p)
  let result = new Point(x, y.neg().umod(curve.p))

  assert(isOnCurve(result))

  return result
}

function pointAdd(point1, point2){
  assert(isOnCurve(point1))
  if(point2 === null)
    return this;
  assert(isOnCurve(point2))

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

  if(k.umod(curve.n).isZero() || point === null)
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
