import {BN, toBN} from './utils.js'

class Point {
  constructor(x, y){
    this.x = BN.isBN(x) ? x : toBN(x);
    this.y = BN.isBN(y) ? y : toBN(y);
  }

  serialize(){
    return `0x${this.x.toString(16)},0x${this.y.toString(16)}`
  }

  static deserialize(p){
    let [x, y] = p.split(',');
    return new Point(x, y);
  }
}

export default Point;
