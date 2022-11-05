const BigNumber = require('bignumber.js');
BigNumber.set({DECIMAL_PLACES: 26})
const toBN = require('web3').utils.toBN;

module.exports.timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports.getTimestamp = () => Math.floor(Date.now() / 1000);
module.exports.newCallId = () => {
  return Date.now().toString(32) + Math.floor(Math.random()*999999999).toString(32);
}
module.exports.sortObject = o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {})
module.exports.floatToBN = (num, decimals) => {
  let n0 = new BigNumber(num).multipliedBy(`1e${decimals}`);
  let n1 = n0.decimalPlaces(decimals).integerValue();
  return toBN(`0x${n1.toString(16)}`);
}
module.exports.parseBool = v => {
  if(typeof v === 'string')
    v = v.toLowerCase();
  return v === '1' || v==='true' || v === true || v === 1;
}

const flattenObject = (obj, prefix="") => {
  let result = {}
  if(Array.isArray(obj)){
    for(let i=0 ; i<obj.length ; i++){
      let newKey = !!prefix ? `${prefix}[${i}]` : `[${i}]`
      result = {
        ...result,
        ...flattenObject(obj[i], newKey)
      }
    }
  }
  else if(typeof obj === 'object' && obj !== null){
    for(let key of Object.keys(obj)){
      let newKey = !!prefix ? `${prefix}.${key}` : key
      result = {
        ...result,
        ...flattenObject(obj[key], newKey)
      }
    }
  }
  else{
    return !!prefix ? {[prefix]: obj} : obj
  }
  return result
}
module.exports.flattenObject = flattenObject
// https://stackoverflow.com/questions/28222228/javascript-es6-test-for-arrow-function-built-in-function-regular-function
module.exports.isArrowFn = (fn) => (typeof fn === 'function') && !/^(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*\s*(?:(?:(?:async\s(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*\s*)?function|class)(?:\s|(?:(?:\/\*[^(?:\*\/)]*\*\/\s*)|(?:\/\/[^\r\n]*))*)|(?:[_$\w][\w0-9_$]*\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*\()|(?:\[\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*(?:(?:['][^']+['])|(?:["][^"]+["]))\s*(?:\/\*[^(?:\*\/)]*\*\/\s*)*\s*\]\())/.test(fn.toString());

module.exports.deepFreeze = function deepFreeze (object) {
  // Retrieve the property names defined on object
  const propNames = Object.getOwnPropertyNames(object);

  // Freeze properties before freezing self

  for (const name of propNames) {
    const value = object[name];

    if (value && typeof value === "object") {
      deepFreeze(value);
    }
  }

  return Object.freeze(object);
}

module.exports.stackTrace = function() {
  let err = new Error();
  return err.stack;
}
