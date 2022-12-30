/**
 * Libraries for import inside user Apps
 */

import axios from 'axios'
import Web3 from 'web3'
import * as tron from '../utils/tron.js'
import lodash from 'lodash'
import BigNumber from 'bignumber.js'
import { toBaseUnit } from '../utils/crypto.js'
import { timeout, floatToBN } from '../utils/helpers.js'
import util from 'ethereumjs-util'
import ws from 'ws'
import ethSigUtil from 'eth-sig-util'
import {
  getBlock as ethGetBlock,
  getBlockNumber as ethGetBlockNumber,
  getPastEvents as ethGetPastEvents,
  read as ethRead,
  call as ethCall,
  getTokenInfo as ethGetTokenInfo,
  getNftInfo as ethGetNftInfo,
  hashCallOutput as ethHashCallOutput
} from '../utils/eth.js'
import soliditySha3 from '../utils/soliditySha3.js'
import { multiCall } from '../utils/multicall.js'
import { BNSqrt } from'../utils/bn-sqrt.js'

const { flatten, groupBy } = lodash;

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
