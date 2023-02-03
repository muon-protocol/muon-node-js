import Web3 from 'web3'
import EventEmbitter from 'events'
import { sortObject, getTimestamp } from './helpers.js'
import * as crypto from './crypto.js'
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ERC20_ABI =require('../data/ERC20-ABI.json')
const ERC721_ABI = require('../data/ERC721-ABI.json')

const HttpProvider = Web3.providers.HttpProvider
const WebsocketProvider = Web3.providers.WebsocketProvider

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
  100: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_XDAI_MAINNET || 'https://rpc.xdaichain.com/')),
  77: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_XDAI_SOKOL_TESTNET || 'https://sokol.poa.network')),
  137: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_POLYGON)),
  80001: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_MUMBAI)),
  43113: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_AVALANCHE_FUJI_TESTNET || 'https://api.avax-test.network/ext/bc/C/rpc')),
  43114: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_AVALANCHE_MAINNET || 'https://api.avax.network/ext/bc/C/rpc')),
  421611: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ARBITRUM_TESTNET || 'https://rinkeby.arbitrum.io/rpc')),
  42161: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ARBITRUM_MAINNET || 'https://arb1.arbitrum.io/rpc')),
  1088: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_METIS || 'https://andromeda.metis.io/?owner=1088')),
  10: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_OPTIMISM || 'https://rpc.ankr.com/optimism')),
  420: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_OPTIMISM_TESTNET || 'https://rpc.ankr.com/optimism_testnet')),
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
  metis: 1088, // Metis
  optimism: 10, // Optimism
  optimismTestnet: 420, // Optimism Testnet
}

function getNetworkId(network) {
  if(!!_networksWeb3[network])
    return network
  return nameToChainIdMap[network]
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

function getBlock(network, blockHashOrBlockNumber) {
  return getWeb3(network).then((web3) => {
    return web3.eth.getBlock(blockHashOrBlockNumber)
  })
}

function getBlockNumber(network) {
  return getWeb3(network).then((web3) => {
    return web3.eth.getBlockNumber()
  })
}

function getPastEvents(network, contractAddress, abi, event, options) {
  return getWeb3(network).then((web3) => {
    let contract = new web3.eth.Contract(abi, contractAddress)
    return contract.getPastEvents(event, options)
  })
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

export {
  getWeb3,
  getNetworkId,
  getBlock,
  getBlockNumber,
  getPastEvents,
  getWeb3Sync,
  hashCallOutput,
  soliditySha3,
  getTransaction,
  getTransactionReceipt,
  call,
  read,
  subscribeLogEvent,
  getTokenInfo,
  getNftInfo
}
