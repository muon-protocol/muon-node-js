/**
 * Libraries for import inside user Apps
 */

import axios from 'axios'
import Web3 from 'web3'
import * as tron from '../utils/tron.js'
import lodash from 'lodash'
import { toBaseUnit } from '../utils/crypto.js'
import { timeout, floatToBN } from '../utils/helpers.js'
import util from 'ethereumjs-util'
import ws from 'ws'
import ethSigUtil from 'eth-sig-util'
import {
  getBlock as ethGetBlock,
  getBlockNumber as ethGetBlockNumber,
  getPastEvents as ethGetPastEvents,
  call as ethCall,
  getTokenInfo as ethGetTokenInfo,
  getNftInfo as ethGetNftInfo,
  hashCallOutput as ethHashCallOutput
} from '../utils/eth.js'
import { multiCall } from '../utils/multicall.js'
import { BNSqrt } from'../utils/bn-sqrt.js'
import BN from "bn.js";
import {toBN} from "../utils/tss/utils.js";
import {muonSha3} from "../utils/sha3.js";

const { flatten, groupBy } = lodash;
const web3Instance = new Web3('http://localhost:8545');

function ecRecover(message, signature) {
  return web3Instance.eth.accounts.recover(message, signature);
}

global.MuonAppUtils = {
  axios,
  Web3,
  lodash,
  flatten,
  groupBy,
  tron,
  ws,
  timeout,
  BN,
  toBN,
  floatToBN,
  multiCall,
  ethGetBlock,
  ethGetBlockNumber,
  muonSha3,
  ethGetPastEvents,
  ethCall,
  ethGetTokenInfo,
  ethGetNftInfo,
  ethHashCallOutput,
  toBaseUnit,
  ecRecover,
  recoverTypedSignature: ethSigUtil.recoverTypedSignature,
  recoverTypedMessage: ethSigUtil.recoverTypedMessage,
  BNSqrt: BNSqrt
}
