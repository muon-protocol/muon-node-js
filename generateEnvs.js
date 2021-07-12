const PeerId = require('peer-id')
const fs = require('fs')
const Web3 = require('web3')
const parseArgv = require('./utils/parseArgv')
const web3 = new Web3()

const createEnv = async () => {
  let params = parseArgv()
  let node_n = params['n'] ? params['n'] : 2
  console.log(params)

  /***** Create Env1 ******/
  let accountEnv1 = web3.eth.accounts.create()
  let libP2PConfigsEnv1 = await PeerId.create({ bits: 1024, keyType: 'RSA' })
  libP2PConfigsEnv1 = libP2PConfigsEnv1.toJSON()
  let env1 = `
  REDIS_HOST = localhost\n
  REDIS_QUEUE = muon_queue_1\n
  REDIS_GATEWAY_CHANNEL = dev_node\n
  GATEWAY_HOST = 0.0.0.0\n
  GATEWAY_PORT = ${params['p'] ? params['p'] : 8080}\n
  MONGODB_CS = mongodb://localhost:27017/muon_dev\n
  # ============ LibP2P Configs ==============
  PEER_ID = "${libP2PConfigsEnv1.id}"\n
  PEER_PUBLIC_KEY = "${libP2PConfigsEnv1.pubKey}"\n
  PEER_PRIVATE_KEY = "${libP2PConfigsEnv1.privKey}"\n
  PEER_PORT = 4000\n
  SIGN_WALLET_ADDRESS = ${accountEnv1.address}\n
  SIGN_WALLET_PRIVATE_KEY = ${accountEnv1.privateKey.substr(2)}
  FINNHUB_API_KEY = c0v5f0v48v6pr2p75fmg\n
  INFURA_PROJECT_ID=ece9c4a96f684e49a17747b64dd54684\n

  PRICE_TOLERANCE=0.05\n
  NUM_SIGN_TO_CONFIRM = 2\n

  FINNHUB_SUBSCRIBE_SYMBOLS="GME;TSLA"\n

  WEB3_PROVIDER_GANACHE = "http://localhost:8545"\n
  WEB3_PROVIDER_ETH = "https://mainnet.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
  WEB3_PROVIDER_ROPSTEN = "https://ropsten.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
  WEB3_PROVIDER_RINKEBY = "https://rinkeby.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
  WEB3_PROVIDER_BSC = "https://bsc-dataseed1.binance.org"\n
  WEB3_PROVIDER_BSCTEST = "https://data-seed-prebsc-1-s2.binance.org:8545"\n
  WEB3_PROVIDER_FTM = "https://rpcapi.fantom.network/"\n
  WEB3_PROVIDER_FTMTEST = "https://rpc.testnet.fantom.network/"\n

  watch_muon_on_bsctest="0xda2D1567Dfca43Dc2Bc9f8D072D746d0bfbF3E1a"\n
  watch_muon_on_rinkeby="0x8ed35887C77Ee1BB533f05f85661fcDeF1FEda1E"\n
  watch_muon_on_ftmtest="0x5D91EA00E414BB113C8ECe6674F84C906BD8b5D4"\n

  MUON_PLUGINS = ''\n
  MUON_CUSTOM_APPS = "muon-presale|sample"
  `
  fs.writeFileSync('./dev-chain/dev-node-1.env', env1)

  /***** Create Other Envs ******/

  for (let index = 1; index < node_n; index++) {
    let libP2PConfigs = await PeerId.create({ bits: 1024, keyType: 'RSA' })
    libP2PConfigs = libP2PConfigs.toJSON()
    let account = web3.eth.accounts.create()
    let env2 = `
    REDIS_HOST = localhost\n
    REDIS_QUEUE = muon_queue_${index + 1}\n
    REDIS_GATEWAY_CHANNEL = dev_node\n
    GATEWAY_HOST = 0.0.0.0\n
    GATEWAY_PORT = ${params['p'] ? Number(params['p']) + index : 8080 + index}\n
    MONGODB_CS = mongodb://localhost:27017/muon_dev\n
    # ============ LibP2P Configs ==============
    PEER_ID = "${libP2PConfigs.id}"\n
    PEER_PUBLIC_KEY = "${libP2PConfigs.pubKey}"\n
    PEER_PRIVATE_KEY = "${libP2PConfigs.privKey}"\n
    PEER_PORT = ${index + 4000}\n
    PEER_BOOTSTRAP_0= "/ip4/127.0.0.1/tcp/4000/p2p/${libP2PConfigsEnv1.id}"
    SIGN_WALLET_ADDRESS = ${account.address}\n
    SIGN_WALLET_PRIVATE_KEY = ${account.privateKey.substr(2)}
    FINNHUB_API_KEY = c0v5f0v48v6pr2p75fmg\n
    INFURA_PROJECT_ID=ece9c4a96f684e49a17747b64dd54684\n
  
    PRICE_TOLERANCE=0.05\n
    NUM_SIGN_TO_CONFIRM = 2\n
  
    FINNHUB_SUBSCRIBE_SYMBOLS="GME;TSLA"\n
  
    WEB3_PROVIDER_GANACHE = "http://localhost:8545"\n
    WEB3_PROVIDER_ETH = "https://mainnet.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
    WEB3_PROVIDER_ROPSTEN = "https://ropsten.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
    WEB3_PROVIDER_RINKEBY = "https://rinkeby.infura.io/v3/ece9c4a96f684e49a17747b64dd54684"\n
    WEB3_PROVIDER_BSC = "https://bsc-dataseed1.binance.org"\n
    WEB3_PROVIDER_BSCTEST = "https://data-seed-prebsc-1-s2.binance.org:8545"\n
    WEB3_PROVIDER_FTM = "https://rpcapi.fantom.network/"\n
    WEB3_PROVIDER_FTMTEST = "https://rpc.testnet.fantom.network/"\n
  
    watch_muon_on_bsctest="0xda2D1567Dfca43Dc2Bc9f8D072D746d0bfbF3E1a"\n
    watch_muon_on_rinkeby="0x8ed35887C77Ee1BB533f05f85661fcDeF1FEda1E"\n
    watch_muon_on_ftmtest="0x5D91EA00E414BB113C8ECe6674F84C906BD8b5D4"\n
  
    MUON_PLUGINS = ''\n
    MUON_CUSTOM_APPS = "muon-presale|sample"
    `
    fs.writeFileSync(`./dev-chain/dev-node-${index + 1}.env`, env2)
  }

  console.log('Environment is created successfully for run nodes')
}

createEnv()
