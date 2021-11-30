const { soliditySha3, ethCall, ethGetNftInfo, ethHashCallOutput } = MuonAppUtils

const ABI_getTx = [
  {
    inputs: [{ internalType: 'uint256', name: '_txId', type: 'uint256' }],
    name: 'getTx',
    outputs: [
      { internalType: 'uint256', name: 'txId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint256', name: 'fromChain', type: 'uint256' },
      { internalType: 'uint256', name: 'toChain', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' },
      { internalType: 'uint256[]', name: 'nftId', type: 'uint256[]' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]
const ABI_getTokenId = [
  {
    inputs: [{ internalType: 'address', name: '_addr', type: 'address' }],
    name: 'getTokenId',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

module.exports = {
  APP_NAME: 'nft_bridge',
  APP_ID: 4,
  REMOTE_CALL_TIMEOUT: 20000,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim': {
        let { depositAddress, depositTxId, depositNetwork = 'eth' } = params

        if (!depositAddress) throw { message: 'Invalid contract "address"' }
        if (!depositTxId) throw { message: 'Invalid depositTxId' }

        let result = await ethCall(
          depositAddress,
          'getTx',
          [depositTxId],
          ABI_getTx,
          depositNetwork
        )
        return result
      }
      case 'addBridgeToken': {
        let { mainTokenAddress, mainNetwork, targetNetwork, sourceBridge } =
          params

        let currentId = await ethCall(
          sourceBridge,
          'getTokenId',
          [mainTokenAddress],
          ABI_getTokenId,
          mainNetwork
        )
        let token = await ethGetNftInfo(mainTokenAddress, mainNetwork)

        let result = {
          token: {
            symbol: token.symbol.replace('μ-', ''),
            name: token.name.replace('Muon ', '')
          },
          tokenId: currentId == 0 ? mainTokenAddress : currentId
        }
        return result
      }
      default:
        throw { message: `Unknown method ${method}` }
    }
  },

  hashRequestResult: function (request, result) {
    switch (request.method) {
      case 'claim': {
        let { depositAddress } = request.data.params

        let { txId, tokenId, fromChain, toChain, user, nftId } = result

        return soliditySha3([
          { type: 'address', value: depositAddress },
          { type: 'uint256', value: txId },
          { type: 'uint256', value: tokenId },
          { type: 'uint256', value: fromChain },
          { type: 'uint256', value: toChain },
          { type: 'address', value: user },
          { type: 'uint8', value: this.APP_ID },
          { type: 'uint256', value: request.data.timestamp },
          { type: 'uint256[]', value: nftId }
        ])
      }
      case 'addBridgeToken': {
        let { token, tokenId } = result

        return soliditySha3([
          { type: 'uint256', value: tokenId },
          { type: 'string', value: token.name },
          { type: 'string', value: token.symbol },
          { type: 'uint8', value: this.APP_ID }
        ])
      }
      default:
        return null
    }
  }
}
