const axios = require('axios')
const Web3 = require('web3')
const web3Instance = new Web3;
const {toBaseUnit} = require('../utils/crypto')
const {timeout} = require('../utils/helpers')
const util = require('ethereumjs-util');
const ethSigUtil = require('eth-sig-util')
const {read : ethRead, call: ethCall} = require('../utils/node-utils/eth')

function soliditySha3(params){
  return web3Instance.utils.soliditySha3(...params);
}

global.MuonAppUtils = {
  axios,
  Web3,
  timeout,
  BN: Web3.utils.BN,
  ethRead,
  ethCall,
  toBaseUnit,
  soliditySha3,
  ecRecover: util.ecrecover,
  recoverTypedSignature: ethSigUtil.recoverTypedSignature,
}
