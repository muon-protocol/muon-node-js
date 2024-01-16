import { CID } from "multiformats/cid"
import { sha256 } from "multiformats/hashes/sha2";
import * as dagPB from "@ipld/dag-pb";
import { base16 } from "multiformats/bases/base16";
import Hash from "pure-ipfs-only-hash"
import fs from "fs"

// Returns IPFS hash of the file content in hex
async function fileCID(fileName) {
  const data = fs.readFileSync(fileName, "utf8");
  const hash = await Hash.of(data);
  return "0x" + Buffer.from(hash).toString("hex");
}

async function createCIDFromString(str) {
  const bytes = dagPB.encode({
    // @ts-ignore
    Data: new TextEncoder("utf8").encode(`${str}`),
    Links: [],
  });
  const hash = await sha256.digest(bytes);
  return CID.create(1, dagPB.code, hash);
}

// // https://github.com/multiformats/multibase#multibase-table
// function cid2hex(cid) {
//   return cid.toString(base16.encoder).substr(1);
// }
// function hex2cid(hex) {
//   return new CID("f" + hex.toLowerCase());
// }
function cid2str(cid) {
  return cid.toString(base16.encoder);
}
function loadCID(strCID) {
  return CID.parse(strCID, base16.decoder);
}

export {
  createCIDFromString,
  // cid2hex,
  // hex2cid,
  cid2str,
  loadCID,
  fileCID
};
