const BaseApp = require('./base/base-app-plugin')
const BaseTssApp = require('./base/base-tss-app-plugin')
const ethUtils = require('../utils/eth')

class EthAppPlugin extends BaseTssApp {
  APP_NAME = 'eth'

  async onRequest(request){
    let {method, data: {params}} = request;
    // console.dir({method, params}, {depth: null})
    switch (method) {
      case 'call':{
        let {
          address: contractAddress,
          method: contractMethod,
          params: contractParams = [],
          abi,
          outputs=[],
          network="eth"
        } = params;

        if (!contractAddress)
          throw {message: 'Invalid contract "address"'}
        if (!contractMethod)
          throw {message: 'Invalid contract method name'}
        if (!abi)
          throw {message: 'Invalid contract method abi'}
        if(!Array.isArray(outputs))
          throw {message: 'Outputs should be an array'}

        let result = await ethUtils.call(contractAddress, contractMethod, contractParams, abi, network)
        return result;
      }
      case 'addBridgeToken':{
        let {mainTokenAddress, mainNetwork, targetNetwork} = params;

        let result = {
          token: await ethUtils.getTokenInfo(mainTokenAddress, mainNetwork),
          tokenId: mainTokenAddress,
        }
        return result;
      }
      default:
        throw {message: `Unknown method ${method}`}
    }
  }

  hashRequestResult(request, result) {
    switch (request.method) {
      case 'call': {
        let {address, method, abi, outputs} = request.data.params;
        return ethUtils.hashCallOutput(address, method, abi, result, outputs)
      }
      case 'addBridgeToken': {
        let {token, tokenId} = result;
        return ethUtils.soliditySha3([
          {type: 'uint256', value: tokenId},
          {type: 'string', value: token.name},
          {type: 'string', value: token.symbol},
          {type: 'uint8', value: token.decimals},
        ]);
      }
      default:
        return null;
    }
  }
}

module.exports = EthAppPlugin

