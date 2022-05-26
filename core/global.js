/**
 * Libraries for import inside user Apps
 */

const axios = require('axios')
const Web3 = require('web3')
const tron = require('../utils/tron')
const web3Instance = new Web3()
const { flatten, groupBy } = require('lodash')

const { toBaseUnit } = require('../utils/crypto')
const { timeout, floatToBN } = require('../utils/helpers')
const util = require('ethereumjs-util')
const ws = require('ws')
const ethSigUtil = require('eth-sig-util')
const {
  read: ethRead,
  call: ethCall,
  getTokenInfo: ethGetTokenInfo,
  getNftInfo: ethGetNftInfo,
  hashCallOutput: ethHashCallOutput,
  getWeb3
} = require('../utils/eth')
const { BigNumber } = require('bignumber.js')
const { multiCall } = require('../utils/multicall')
const { BNSqrt } = require('../utils/bn-sqrt')

function soliditySha3(params) {
  return web3Instance.utils.soliditySha3(...params)
}

global.MuonAppUtils = {
  axios,
  Web3,
  flatten,
  groupBy,
  tron,
  ws,
  timeout,
  BigNumber,
  BN: Web3.utils.BN,
  toBN: Web3.utils.toBN,
  floatToBN,
  multiCall,
  getWeb3,
  ethRead,
  ethCall,
  ethGetTokenInfo,
  ethGetNftInfo,
  ethHashCallOutput,
  toBaseUnit,
  soliditySha3,
  ecRecover: util.ecrecover,
  recoverTypedSignature: ethSigUtil.recoverTypedSignature,
  recoverTypedMessage: ethSigUtil.recoverTypedMessage,
  BNSqrt: BNSqrt
}
