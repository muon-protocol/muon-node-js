const {range, toBN, BN} = require('./utils')

class Polynomial {
  coefficients = []

  constructor(t, curve, key0){
    if(key0 && !BN.isBN(key0))
      throw {message: "invalid key0 of polynomial"}
    this.curve = curve;
    this.t = t;
    this.coefficients = [key0 ? curve.keyFromPrivate(key0) : curve.genKeyPair(), ...range(1, t).map(() => curve.genKeyPair())]
  }

  calc(x){
    let _x = BN.isBN(x) ? x : toBN(x);
    let result = toBN(0);
    for (let i = 0; i < this.coefficients.length; i++) {
      result.iadd(this.coefficients[i].getPrivate().mul(_x.pow(toBN(i))));
    }
    return result.umod(this.curve.n)
  }

  coefPubKeys() {
    return this.coefficients.map(a => a.getPublic())
  }
}

module.exports = Polynomial;
