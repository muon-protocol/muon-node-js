const { ethCall, soliditySha3 } = MuonAppUtils

const ABI_getTransaction = [
  {
    inputs: [{ internalType: 'uint256', name: 'txId_', type: 'uint256' }],
    name: 'getTransaction',
    outputs: [
      { internalType: 'uint256', name: 'txId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'fromChain', type: 'uint256' },
      { internalType: 'uint256', name: 'toChain', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' },
      { internalType: 'uint256', name: 'txBlockNo', type: 'uint256' },
      { internalType: 'uint256', name: 'currentBlockNo', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const confirmationBlock = {
  polygon: 256,
  mumbai: 256,
  eth: 24,
  ropsten: 24,
  rinkeby: 24,
  bsc: 30,
  bsctest: 30,
  Avax: 24,
  ftm: 6,
  ftmtest: 6,
  arbitrum: 6,
  metis: 35
}

module.exports = {
  APP_NAME: 'deus_bridge',
  APP_ID: 7,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { depositAddress, depositTxId, depositNetwork } = params

        if (!depositAddress) throw { message: 'Invalid contarct address' }
        if (!depositTxId) throw { message: 'Invalid depositTxId' }
        if (!depositNetwork) throw { message: 'Invalid network' }

        let {
          txId,
          tokenId,
          amount,
          fromChain,
          toChain,
          user,
          txBlockNo,
          currentBlockNo
        } = await ethCall(
          depositAddress,
          'getTransaction',
          [depositTxId],
          ABI_getTransaction,
          depositNetwork
        )
        if (currentBlockNo < txBlockNo + confirmationBlock[depositNetwork])
          throw { message: 'Bridge: confirmationTime is not finished yet' }

        return { txId, tokenId, amount, fromChain, toChain, user }

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
        let { depositAddress } = params
        let { txId, tokenId, amount, fromChain, toChain, user } = result

        return soliditySha3([
          { type: 'address', value: depositAddress },
          { type: 'uint256', value: txId },
          { type: 'uint256', value: tokenId },
          { type: 'uint256', value: amount },
          { type: 'uint256', value: fromChain },
          { type: 'uint256', value: toChain },
          { type: 'address', value: user },
          { type: 'uint8', value: this.APP_ID }
        ])

      default:
        return null
    }
  }
}
