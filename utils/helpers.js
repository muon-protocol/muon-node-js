
module.exports.timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports.getTimestamp = () => Math.floor(Date.now() / 1000);
module.exports.newCallId = () => {
  return Date.now().toString(32) + Math.floor(Math.random()*999999).toString(32);
}
module.exports.sortObject = o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {})
module.exports.flattenObject = (obj, prefix="") => {
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
