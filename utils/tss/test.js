const {BN, toBN} = require('./utils')

let a = new BN(10)
a.shrn(1);

console.log({
  a: a.toString(),
  sr: a.shrn(1).toString(),
});
