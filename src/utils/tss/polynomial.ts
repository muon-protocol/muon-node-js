import { range, buf2bigint } from './utils.js'
import * as noble from '@noble/secp256k1'

class Polynomial {
  curve
  t: number
  coefficients: bigint[] = []

  constructor(t, curve, key0?: bigint){
    this.curve = curve;
    this.t = t;
    this.coefficients = [key0 ? key0 : buf2bigint(noble.utils.randomPrivateKey()), ...range(1, t).map(() => buf2bigint(noble.utils.randomPrivateKey()))]
  }

  calc(x: bigint): bigint{
    if(typeof x != 'bigint')
      x = BigInt(x);
    let result: bigint = BigInt('0');
    for (let i = 0; i < this.coefficients.length; i++) {
      result += this.coefficients[i] * x ** BigInt(i);
    }
    return noble.utils.mod(result, noble.CURVE.n)
  }

  coefPubKeys(basePoint?: noble.Point): noble.Point[] {
    if(!!basePoint) {
      return this.coefficients.map(pk => basePoint.multiply(pk))
    }
    return this.coefficients.map(a => noble.Point.fromHex(noble.getPublicKey(a)))
  }
}

export default Polynomial;
