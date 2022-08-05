const {BN, toBN, randomHex} = require('./utils');
const Point = require('./point')

class Curve {
  constructor(name, p, a, b, g, n, h) {
    this.name = name
    this.p = BN.isBN(p) ? p : toBN(p);
    this.a = BN.isBN(a) ? a : toBN(a);
    this.b = BN.isBN(b) ? b : toBN(b);
    this.g = g;
    this.n = BN.isBN(n) ? b : toBN(n);
    this.h = BN.isBN(h) ? b : toBN(h);
  }

  random(exact){
    let byteSize = this.n.byteLength();
    let rand = randomHex(byteSize);
    let num = toBN(rand).umod(this.n);
    if(exact)
      return num;
    else
      return num.div(toBN('0xffff'));
  }
}

module.exports.secp256k1 = new Curve(
  'secp256k1',
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
  0,
  7,
  new Point(
    '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
  ),
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
  1
);
