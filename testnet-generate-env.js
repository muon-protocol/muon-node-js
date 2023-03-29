import * as dotenv from "dotenv"
dotenv.config();
import {createRSAPeerId} from '@libp2p/peer-id-factory'
import * as  fs from "fs"
import Web3 from "web3"
import {keys as cryptoKeys} from '@libp2p/crypto'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
const web3 = new Web3();

// @ts-ignore
function toB64Opt (val) {
  if (val) {
    return uint8ArrayToString(val, 'base64pad')
  }
}

export function peerIdToJSON(peerId) {
  const json = {
    id: peerId.toString(),
  }
  if(peerId.privateKey) {
    json.privKey = toB64Opt(cryptoKeys.marshalPrivateKey({bytes: peerId.privateKey}))
  }
  if(peerId.publicKey) {
    json.pubKey = toB64Opt(cryptoKeys.marshalPublicKey({bytes: peerId.publicKey}))
  }
  return json;
}

const createEnv = async () => {
  if(fs.existsSync('./.env')) {
    console.log('.env file already exists.');
    process.exit(0);
  }

  let wallet = web3.eth.accounts.create();
  let peerId = await createRSAPeerId({bits: 1024});
  peerId = peerIdToJSON(peerId);
  let env = fs.readFileSync(".env.testnet", "utf8");

  env = env.replace("__SIGN_WALLET_ADDRESS__", wallet.address);
  env = env.replace("__SIGN_WALLET_PRIVATE_KEY__", wallet.privateKey.substr(2));

  env = env.replace("__PEER_ID__", peerId.id);
  env = env.replace("__PEER_PUBLIC_KEY__", peerId.pubKey);
  env = env.replace("__PEER_PRIVATE_KEY__", peerId.privKey);

  fs.writeFileSync(".env", env);
  console.log('.env created successfully.');
};

createEnv();
