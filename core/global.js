const axios = require('axios')
const Web3 = require('web3')
const web3Instance = new Web3;
const {toBaseUnit} = require('../utils/crypto')

function soliditySha3(params){
  return web3Instance.utils.soliditySha3(...params);
}

global.MuonAppUtils = {
  axios,
  Web3,
  BN: Web3.utils.BN,
  toBaseUnit,
  soliditySha3,
}
