const { soliditySha3, ethCall, ethGetTokenInfo, ethHashCallOutput } = MuonAppUtils

module.exports = {
  APP_NAME: 'eth',

  onRequest: async function (request) {
    let {method, data: {params}} = request;
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

        let result = await ethCall(contractAddress, contractMethod, contractParams, abi, network)
        return result;
      }
      case 'addBridgeToken':{
        let {mainTokenAddress, mainNetwork, targetNetwork} = params;

        let result = {
          token: await ethGetTokenInfo(mainTokenAddress, mainNetwork),
          tokenId: mainTokenAddress,
        }
        return result
      }
      default:
        throw {message: `Unknown method ${method}`}
    }
  },

  hashRequestResult: (request, result) => {
    switch (request.method) {
      case 'call': {
        let {address, method, abi, outputs} = request.data.params;
        return ethHashCallOutput(address, method, abi, result, outputs)
      }
      case 'addBridgeToken': {
        let {token, tokenId} = result;
        return soliditySha3([
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
