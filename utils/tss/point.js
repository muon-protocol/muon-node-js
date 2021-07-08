const {BN, toBN} = require('./utils')

class Point {
  constructor(x, y){
    this.x = BN.isBN(x) ? x : toBN(x);
    this.y = BN.isBN(y) ? y : toBN(y);
  }
}

module.exports = Point;
