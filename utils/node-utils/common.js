const CID = require('cids')
const crypto = require('../crypto')
const multihashing = require('multihashing-async')

async function strToCID(str) {
  const bytes = new TextEncoder('utf8').encode(`${str}`)

  const hash = await multihashing(bytes, 'sha2-256')
  return new CID(0, 'dag-pb', hash)
}

module.exports = {
  strToCID,
}
