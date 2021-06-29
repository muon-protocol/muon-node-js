const axios = require('axios')
const Web3 = require('web3')
const {toBaseUnit, soliditySha3} = require('../utils/crypto')

global.MuonAppUtils = {
  axios,
  Web3,
  BN: Web3.utils.BN,
  toBaseUnit,
  soliditySha3,
}
