/**
 * Libraries for import inside user Apps
 */

const axios = require('axios')
const Web3 = require('web3')
const tron = require('../utils/tron')
const web3Instance = new Web3()
const { flatten, groupBy } = require('lodash')
const { BigNumber } = require('bignumber.js')

const { toBaseUnit } = require('../utils/crypto')
const { timeout, floatToBN } = require('../utils/helpers')
const util = require('ethereumjs-util')
const ws = require('ws')
const ethSigUtil = require('eth-sig-util')
const {
  getBlock: ethGetBlock,
  getBlockNumber: ethGetBlockNumber,
  getPastEvents: ethGetPastEvents,
  read: ethRead,
  call: ethCall,
  getTokenInfo: ethGetTokenInfo,
  getNftInfo: ethGetNftInfo,
  hashCallOutput: ethHashCallOutput
} = require('../utils/eth')

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
  BN: Web3.utils.BN,
  BigNumber,
  toBN: Web3.utils.toBN,
  floatToBN,
  multiCall,
  ethGetBlock,
  ethGetBlockNumber,
  ethGetPastEvents,
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
