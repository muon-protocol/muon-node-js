const { ethCall, soliditySha3 } = MuonAppUtils

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

module.exports = {
  APP_NAME: 'mrc721_bridge',
  APP_ID: 10,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { depositAddress, depositTxId, depositNetwork } = params

        if (!depositAddress) throw { message: 'Invalid contarct address' }
        if (!depositTxId) throw { message: 'Invalid deposit Tx Id' }
        if (!depositNetwork) throw { message: 'Invalid deposit Network' }

        let result = await ethCall(
          depositAddress,
          'getTx',
          [depositTxId],
          ABI_getTx,
          depositNetwork
        )
        return result

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'claim':
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
          { type: 'uint256[]', value: nftId }
        ])

      default:
        return null
    }
  }
}
