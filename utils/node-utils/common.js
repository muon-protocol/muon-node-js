const CID = require('cids')
const multihashing = require('multihashing-async')

async function strToCID(str) {
  const bytes = new TextEncoder('utf8').encode(`${str}`)

  const hash = await multihashing(bytes, 'sha2-256')
  return new CID(1, 'dag-pb', hash, 'base16')
}

// https://github.com/multiformats/multibase#multibase-table
function cid2hex(cid){
  return cid.toString().substr(1);
}
function hex2cid(hex){
  return new CID('f' + hex.toLowerCase());
}

module.exports = {
  strToCID,
  cid2hex,
  hex2cid
}
