const Web3 = require('web3')
const EventEmbitter = require('events')
const HttpProvider = Web3.providers.HttpProvider
const WebsocketProvider = Web3.providers.WebsocketProvider
const {createCIDFromString} = require('./common')
const { flattenObject, sortObject, getTimestamp } = require('../helpers')
const crypto = require('../crypto')
const ERC20_ABI = require('../../data/ERC20-ABI')
const ERC721_ABI = require('../../data/ERC721-ABI')

const _generalWeb3Instance = new Web3()
const soliditySha3 = _generalWeb3Instance.utils.soliditySha3

const _networksWeb3 = {
  ganache: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_GANACHE)),
  // ethereum mani net
  1: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ETH)),
  3: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ROPSTEN)),
  4: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_RINKEBY)),
  56: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_BSC)),
  97: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_BSCTEST)),
  250: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_FTM)),
  4002: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_FTMTEST)),
  100: new Web3(new HttpProvider('https://rpc.xdaichain.com/')),
  77: new Web3(new HttpProvider('https://sokol.poa.network')),
  137: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_POLYGON)),
  80001: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_MUMBAi)),
  43113: new Web3(
    new HttpProvider('https://api.avax-test.network/ext/bc/C/rpc')
  ),
  43114: new Web3(new HttpProvider('https://api.avax.network/ext/bc/C/rpc')),
  421611: new Web3(new HttpProvider('https://rinkeby.arbitrum.io/rpc')),
  42161: new Web3(new HttpProvider('https://arb1.arbitrum.io/rpc')),
  1088: new Web3(new HttpProvider(' https://andromeda.metis.io/?owner=1088'))
}

const nameToChainIdMap = {
  local: 'ganache',
  eth: 1, // Ethereum mainnet
  ropsten: 3, // Ethereum ropsten testnet
  rinkeby: 4, // Ethereum rinkeby testnet
  bsc: 56, // Binance Smart Chain mainnet
  bsctest: 97, // Binance Smart Chain testnet
  ftm: 250, // Fantom mainnet
  ftmtest: 4002, // Fantom testnet
  xdai: 100, // Xdai mainnet
  sokol: 77, // Xdai testnet
  polygon: 137, // polygon mainnet
  mumbai: 80001, // Polygon mumbai testnet
  fuji: 43113, // Avalanche Fuji Testnet
  avax: 43114, // Avalanche Mainnet
  arbitrumTestnet: 421611, //Arbitrum Testnet
  arbitrum: 42161, // Arbitrum
  metis: 1088 // Metis
}

function getWeb3(network) {
  if (_networksWeb3[network]) return Promise.resolve(_networksWeb3[network])
  else if (_networksWeb3[nameToChainIdMap[network]])
    return Promise.resolve(_networksWeb3[nameToChainIdMap[network]])
  else return Promise.reject({ message: `invalid network "${network}"` })
}

function getWeb3Sync(network) {
  if (_networksWeb3[network]) return _networksWeb3[network]
  else if (_networksWeb3[nameToChainIdMap[network]])
    return _networksWeb3[nameToChainIdMap[network]]
  else throw { message: `invalid network "${network}"` }
}

function hashCallOutput(
  address,
  method,
  abi,
  result,
  outputFilter = [],
  extraParams = []
) {
  let methodAbi = abi.find(
    ({ name, type }) => name === method && type === 'function'
  )
  if (!methodAbi) {
    throw { message: `Abi of method (${method}) not found` }
  }
  let abiOutputs = methodAbi.outputs
  if (!!outputFilter && outputFilter.length > 0) {
    abiOutputs = outputFilter.map((key) => {
      return methodAbi.outputs.find(({ name }) => name === key)
    })
  }
  // console.log('signing:',abiOutputs)
  let params = abiOutputs.map(({ name, type }) => ({
    type,
    value: !name || typeof result === 'string' ? result : result[name]
  }))
  params = [{ type: 'address', value: address }, ...params, ...extraParams]
  let hash = _generalWeb3Instance.utils.soliditySha3(...params)
  return hash
}

function getTokenInfo(address, network) {
  return getWeb3(network).then(async (web3) => {
    let contract = new web3.eth.Contract(ERC20_ABI, address)
    return {
      symbol: await contract.methods.symbol().call(),
      name: await contract.methods.name().call(),
      decimals: await contract.methods.decimals().call()
    }
  })
}
function getNftInfo(address, network) {
  return getWeb3(network).then(async (web3) => {
    let contract = new web3.eth.Contract(ERC721_ABI, address)
    return {
      symbol: await contract.methods.symbol().call(),
      name: await contract.methods.name().call()
    }
  })
}

function getTransaction(txHash, network) {
  return getWeb3(network).then((web3) => web3.eth.getTransaction(txHash))
}

function getTransactionReceipt(txHash, network) {
  return getWeb3(network).then((web3) => web3.eth.getTransactionReceipt(txHash))
}

function call(contractAddress, methodName, params, abi, network) {
  return getWeb3(network).then((web3) => {
    let contract = new web3.eth.Contract(abi, contractAddress)
    return contract.methods[methodName](...params).call()
  })
}

function read(contractAddress, property, params, abi, network) {
  return getWeb3(network).then((web3) => {
    let contract = new web3.eth.Contract(abi, contractAddress)
    return contract.methods[property].call(...params)
  })
}

async function signRequest(request, result) {
  let signature = null
  let signTimestamp = getTimestamp()

  switch (request.method) {
    case 'call': {
      let { abi, address, method, outputs } = request.data.callInfo
      signature = crypto.signCallOutput(address, method, abi, result, outputs)
      break
    }
    case 'addBridgeToken': {
      let { token, tokenId } = result
      let dataToSign = [
        { type: 'uint256', value: tokenId },
        { type: 'string', value: token.name },
        { type: 'string', value: token.symbol },
        { type: 'uint8', value: token.decimals }
      ]
      signature = crypto.sign(soliditySha3(dataToSign))
      break
    }
    default:
      throw { message: `Unknown eth app method: ${request.method}` }
  }

  return {
    request: request._id,
    owner: process.env.SIGN_WALLET_ADDRESS,
    timestamp: signTimestamp,
    data: result,
    signature
  }
}

function recoverSignature(request, sign) {
  let signer = null
  let { data: result, signature } = sign
  switch (request.method) {
    case 'call': {
      let { address, method, abi, outputs } = request.data.callInfo
      signer = crypto.recoverCallOutputSignature(
        address,
        method,
        abi,
        result,
        outputs,
        signature
      )
      break
    }
    case 'addBridgeToken': {
      let { token, tokenId } = result
      let dataToSign = [
        { type: 'uint256', value: tokenId },
        { type: 'string', value: token.name },
        { type: 'string', value: token.symbol },
        { type: 'uint8', value: token.decimals }
      ]
      signer = crypto.recover(soliditySha3(dataToSign), signature)
      break
    }
    default:
      throw { message: `Unknown eth app method: ${request.method}` }
  }

  return signer
}

const subscribeLogEvent = (
  network,
  contractAddress,
  contractAbi,
  eventName,
  interval = 5000
) => {
  let subscribe = new Subscribe(
    network,
    contractAddress,
    contractAbi,
    eventName,
    interval
  )
  return subscribe
}

class Subscribe extends EventEmbitter {
  constructor(network, contractAddress, abi, eventName, interval = 15000) {
    super()
    let web3 = getWeb3Sync(network)
    let contract = new web3.eth.Contract(abi, contractAddress)

    this.web3 = web3
    this.network = network
    this.interval = interval
    this.contract = contract
    this.lastBlock = -1
    this.eventName = eventName
    this._handler = this._handler.bind(this)

    this.timeout = setTimeout(this._handler, interval)
  }

  async _handler() {
    if (this.lastBlock < 0) {
      let lastBlock = (await this.web3.eth.getBlockNumber()) - 9000
      console.log(
        `watch ${this.network}:${this.contract._address} (${this.eventName}) from block ${lastBlock}`
      )
      this.lastBlock = lastBlock
    }

    let { contract, eventName, lastBlock, network } = this
    contract.getPastEvents(
      eventName,
      {
        // filter: {id: id},
        fromBlock: lastBlock,
        toBlock: 'latest'
      },
      (error, result) => {
        if (!error) {
          let txs = []
          if (result.length > 0) {
            let lastBlock = Math.max(
              ...result.map(({ blockNumber }) => blockNumber)
            )
            this.lastBlock = lastBlock + 1
            txs = result.map(
              ({ transactionHash, returnValues, blockNumber }) => ({
                blockNumber,
                transactionHash,
                returnValues
              })
            )
            this.emit('event', txs, network, contract._address)
          }
        } else {
          this.emit('error', error, network, contract._address)
        }
      }
    )
    setTimeout(this._handler, this.interval)
  }
}

module.exports = {
  getWeb3,
  getWeb3Sync,
  hashCallOutput,
  soliditySha3,
  getTransaction,
  getTransactionReceipt,
  call,
  read,
  signRequest,
  recoverSignature,
  subscribeLogEvent,
  getTokenInfo,
  getNftInfo
}
