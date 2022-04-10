const {CID} = require('multiformats/cid')
import { sha256 } from 'multiformats/hashes/sha2'
import * as dagPB from '@ipld/dag-pb'
import { base16 } from "multiformats/bases/base16"

async function strToCID(str) {
  const bytes = dagPB.encode({
    Data: new TextEncoder('utf8').encode(`${str}`),
    Links: []
  })
  const hash = await sha256.digest(bytes);
  return CID.create(1, dagPB.code, hash)
}

// https://github.com/multiformats/multibase#multibase-table
function cid2hex(cid){
  return cid.toString(base16.encoder).substr(1);
}
function hex2cid(hex){
  return new CID('f' + hex.toLowerCase());
}
function cid2str(cid) {
  return cid.toString(base16.encoder);
}
function loadCID(strCID) {
  return CID.parse(strCID, base16.decoder)
}

module.exports = {
  strToCID,
  cid2hex,
  hex2cid,
  cid2str,
  loadCID,
}
