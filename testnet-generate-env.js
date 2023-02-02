import * as dotenv from "dotenv"
dotenv.config();
import PeerId from 'peer-id'
import * as  fs from "fs"
import Web3 from "web3"
const web3 = new Web3();

const createEnv = async () => {
  if(fs.existsSync('./.env')) {
    console.log('.env file already exists.');
    process.exit(0);
  }

  let wallet = web3.eth.accounts.create();
  let libP2PConfig = await PeerId.create({ bits: 1024, keyType: "RSA" });
  libP2PConfig = libP2PConfig.toJSON();
  let env = fs.readFileSync(".env.testnet", "utf8");

  env = env.replace("__SIGN_WALLET_ADDRESS__", wallet.address);
  env = env.replace("__SIGN_WALLET_PRIVATE_KEY__", wallet.privateKey.substr(2));

  env = env.replace("__PEER_ID__", libP2PConfig.id);
  env = env.replace("__PEER_PUBLIC_KEY__", libP2PConfig.pubKey);
  env = env.replace("__PEER_PRIVATE_KEY__", libP2PConfig.privKey);

  fs.writeFileSync(".env", env);
  console.log('.env created successfully.');  
};

createEnv();
