const { soliditySha3, ethCall, ethGetTokenInfo, ethHashCallOutput, toBN } = MuonAppUtils

module.exports = {
  APP_NAME: 'eth',
  APP_ID: 2,

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
      default:
        throw {message: `Unknown method ${method}`}
    }
  },

  hashRequestResult: function (request, result) {
    switch (request.method) {
      case 'call': {
        let {address, method, abi, outputs, hashTimestamp} = request.data.params;
        let extraHashParams = [
          {type: 'uint8', value: this.APP_ID},
          ...(hashTimestamp ? [{type: 'uint256', value: request.startedAt}] : [])
        ]
        return ethHashCallOutput(
          address,
          method,
          abi,
          result,
          outputs,
          extraHashParams
        )
      }
      default:
        return null;
    }
  }
}
