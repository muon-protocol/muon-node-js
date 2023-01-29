import dotenv from 'dotenv'
import path from 'path'
dotenv.config()
import PeerId from 'peer-id'
import emoji from 'node-emoji'
import fs from 'fs'
import Web3 from 'web3'
import parseArgv from '../src/utils/parseArgv.js'
import devNodesList from './nodes-list.js'
import {filePathInfo} from "../src/utils/helpers.js";

const {__dirname} = filePathInfo(import.meta)
const BASE_PATH = path.join(__dirname, '..');

/**
 * @param data
 * @param data.redisHost {string} - Redis host
 * @param data.redisPort {number} - Redis port
 * @param data.gatewayPort {number} - Gateway port
 * @param data.configPath {string} - Node configurations path
 * @param data.mongoHost {string} - MongoDB host
 * @param data.mongoPort {number} - MongoDB port
 * @param data.mongoDBName {string} - MongoDB database name
 * @param data.signWalletAddress {string} - Node gateway wallet address
 * @param data.signWalletPK {string} - Node gateway wallet privateKey
 * @param data.peerIdAddress {string} - Libp2p peerID address
 * @param data.peerIdPublic {string} - Libp2p peerID public key
 * @param data.peerIdPrivate {string} - Libp2p peerID private key
 * @param data.libp2pListenPort {number} - Libp2p listening port
 * @param data.libp2pBootstrapList {string[]} - Libp2p listening port
 * @param data.infuraProjectId {string} - Infura projectID
 * @returns {string}
 */
function formatEnvContent(data) {
  const bootstrapList = data.libp2pBootstrapList
    .map((addr, index) => `PEER_BOOTSTRAP_${index}="${addr}"`)
    .join("\n")
  return `
# VERBOSE=1

#CLUSTER_MODE = true
#CLUSTER_COUNT = 2

REDIS_HOST = localhost
REDIS_PORT = 6379

GATEWAY_HOST = 0.0.0.0
GATEWAY_PORT = ${data.gatewayPort}

CONFIG_BASE_PATH = ${data.configPath}

MONGODB_CS = mongodb://127.0.0.1:27017/${data.mongoDBName}

# ============ LibP2P Configs ==============
SIGN_WALLET_ADDRESS = ${data.signWalletAddress}
SIGN_WALLET_PRIVATE_KEY = ${data.signWalletPK}

PEER_ID = "${data.peerIdAddress}"
PEER_PUBLIC_KEY = "${data.peerIdPublic}"
PEER_PRIVATE_KEY = "${data.peerIdPrivate}"
PEER_PORT = ${data.libp2pListenPort}
${bootstrapList}
# ===========================================

DISABLE_ANNOUNCE_FILTER=1

INFURA_PROJECT_ID=${data.infuraProjectId}

NUM_SIGN_TO_CONFIRM = 2

WEB3_PROVIDER_GANACHE = "http://localhost:8545"
WEB3_PROVIDER_ETH = "https://mainnet.infura.io/v3/${data.infuraProjectId}"
WEB3_PROVIDER_ROPSTEN = "https://ropsten.infura.io/v3/${data.infuraProjectId}"
WEB3_PROVIDER_RINKEBY = "https://rinkeby.infura.io/v3/${data.infuraProjectId}"
WEB3_PROVIDER_BSC = "https://bsc-dataseed1.binance.org"
WEB3_PROVIDER_BSCTEST = "https://data-seed-prebsc-1-s2.binance.org:8545"
WEB3_PROVIDER_FTM = "https://rpcapi.fantom.network/"
WEB3_PROVIDER_FTMTEST = "https://rpc.testnet.fantom.network/"
WEB3_PROVIDER_POLYGON="https://polygon-rpc.com"
WEB3_PROVIDER_MUMBAI="https://matic-mumbai.chainstacklabs.com"

watch_muon_on_bsctest="0xda2D1567Dfca43Dc2Bc9f8D072D746d0bfbF3E1a"
watch_muon_on_rinkeby="0x8ed35887C77Ee1BB533f05f85661fcDeF1FEda1E"
watch_muon_on_ftmtest="0x5D91EA00E414BB113C8ECe6674F84C906BD8b5D4"

MUON_PLUGINS = ''
MUON_CUSTOM_APPS = "tss-test|sample"
`
}

const createEnv = async () => {
  let params = parseArgv()
  let threshold = params['t'] ? parseInt(params['t']) : 2
  let node_n = params['n'] ? parseInt(params['n']) : 2
  const baseGatewayPort = params['p'] ? parseInt(params['p']) : 8000;
  const baseLibp2pListeningPort = 4000;
  const infuraProjectId = params['infura'] ? params['infura'] : '<YOUR-INFURA-PROJECT-ID>'

  /** remove old configurations */
  const configFiles = fs
    .readdirSync(`${BASE_PATH}/config`)
    .filter((item) => item.startsWith('dev-node'))

  if (configFiles.length > 0) {
    configFiles.forEach((item) => {
      // delete dev-node directory recursively
      fs.rm(`${BASE_PATH}/config/${item}`, { recursive: true, force: true }, (err) => {
        if (err) {
          throw err
        }
      })
    })
  }

  /** generate new .env config files */
  let firstNodeAddress;
  for (let index = 0; index < node_n; index++) {
    let {account, peer} = devNodesList[index];

    if(index === 0)
      firstNodeAddress = `/ip4/127.0.0.1/tcp/${baseLibp2pListeningPort}/p2p/${peer.id}`

    let envContent = formatEnvContent({
      gatewayPort: baseGatewayPort + index,
      configPath: `dev-node-${index+1}`,
      mongoDBName: `muon_dev_${index+1}`,
      signWalletAddress: account.address,
      signWalletPK: account.privateKey,
      peerIdAddress: peer.id,
      peerIdPublic: peer.publicKey,
      peerIdPrivate: peer.privateKey,
      libp2pListenPort: baseLibp2pListeningPort + index,
      libp2pBootstrapList: index===0 ? [] : [firstNodeAddress],
      infuraProjectId: infuraProjectId
    })

    fs.writeFileSync(`${BASE_PATH}/devnet/nodes/dev-node-${index + 1}.env`, envContent)
    console.log(emoji.get('o'), `Node-${index + 1} Ethereum Address: `, account.address)
  }

  /***** Create Other net.conf.json ******/

  let netConf = JSON.stringify(
    {
      "tss": {
        "threshold": threshold,
        "max": 100
      },
      "nodeManager": {
        "network": "mumbai",
        "address": "0x8Abd99F5f74777bd275Ed506D909fd2E9D099Ee6"
      }
    },
    null,
    2
  )

  //TODO: When net.default.conf is updating, net.conf should
  // reload. For example, when address of NodeManager is updating
  // net.conf still refers to the old address
  fs.writeFileSync(`${BASE_PATH}/config/global/net.conf.json`, netConf)
  console.log(emoji.get('o'), `net.conf.json is created`)
  // console.log('Environment is created successfully for run nodes')
}

createEnv()
