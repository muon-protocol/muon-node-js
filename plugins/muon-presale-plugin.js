const BaseApp = require('./base/base-app-plugin')
const {soliditySha3, toBaseUnit} = require('../utils/crypto')
const {getTimestamp} = require('../utils/helpers')
const axios = require('axios');

function getTokens() {
  return axios.get('https://app.deus.finance/prices.json')
    .then(({data}) => data)
}

function getAllowance() {
  return axios.get('https://app.deus.finance/muon-presale.json')
    .then(({data}) => data)
}

class MuonPresalePlugin extends BaseApp {
  APP_NAME = 'presale'

  async onRequest(method, params={}){
    switch (method) {
      case 'deposit':{
        let {token, amount, forAddress,} = params;
        let time = getTimestamp();

        if (!token)
          throw {message: 'Invalid token'}
        if (!amount)
          throw {message: 'Invalid deposit amount'}
        if (!amount)
          throw {message: 'Invalid sender address'}

        let [tokenList, allowance] = await Promise.all([getTokens(), getAllowance()])

        if(!Object.keys(tokenList).includes(token))
          throw {message: 'Token not allowed for deposit'}

        token = tokenList[token]

        if(allowance[forAddress] === undefined)
          throw {message: 'address not allowed for deposit'}

        return {
          token: token.address,
          tokenPrice: token.price,
          amount,
          time,
          forAddress,
          addressMaxCap: toBaseUnit(allowance[forAddress].toString(), '18').toString(),
        }
      }
      default:
        throw {message: `Unknown method ${params}`}
    }
  }

  hashRequestResult(request, result) {
    switch (request.method) {
      case 'deposit': {
        let {token, tokenPrice, amount, forAddress, addressMaxCap} = result;
        return soliditySha3([
          {type: 'address', value: token},
          {type: 'uint256', value: tokenPrice},
          {type: 'uint256', value: amount},
          {type: 'uint256', value: request.data.result.time},
          {type: 'address', value: forAddress},
          {type: 'uint256', value: addressMaxCap},
        ]);
      }
      default:
        return null;
    }
  }
}

module.exports = MuonPresalePlugin

