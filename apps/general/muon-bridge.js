const { soliditySha3, ethCall, ethGetTokenInfo, ethHashCallOutput } = MuonAppUtils

const ABI_getTx = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_txId",
        "type": "uint256"
      }
    ],
    "name": "getTx",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "txId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "fromChain",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "toChain",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

module.exports = {
  APP_NAME: 'bridge',
  APP_ID: 3,

  onRequest: async function (request) {
    let {method, data: {params}} = request;
    switch (method) {
      case 'claim':{
        let {
          depositAddress,
          depositTxId,
          depositNetwork="eth"
        } = params;

        if (!depositAddress)
          throw {message: 'Invalid contract "address"'}
        if (!depositTxId)
          throw {message: 'Invalid depositTxId'}

        let result = await ethCall(depositAddress, 'getTx', [depositTxId], ABI_getTx, depositNetwork)
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

  hashRequestResult: function (request, result) {
    switch (request.method) {
      case 'claim': {
        let {depositAddress} = request.data.params;
        return ethHashCallOutput(depositAddress, 'getTx', ABI_getTx, result, [], [{type: 'uint8', value: this.APP_ID}])
      }
      case 'addBridgeToken': {
        let {token, tokenId} = result;
        return soliditySha3([
          {type: 'uint256', value: tokenId},
          {type: 'string', value: token.name},
          {type: 'string', value: token.symbol},
          {type: 'uint8', value: token.decimals},
          {type: 'uint8', value: this.APP_ID}
        ]);
      }
      default:
        return null;
    }
  }
}
