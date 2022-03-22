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
      { internalType: 'address', name: 'nftContract', type: 'address' },
      { internalType: 'bool', name: 'transferParams', type: 'bool' },
      { internalType: 'uint256[]', name: 'nftId', type: 'uint256[]' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

ABI_encodeParams = [{
      inputs: [
        {
          "internalType": "uint256[]",
          "name": "ids",
          "type": "uint256[]"
        }
      ],
      name: "encodeParams",
      outputs: [
        {
          "internalType": "bytes",
          "name": "",
          "type": "bytes"
        }
      ],
      stateMutability: "view",
      type: "function"
    }]

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
        //TODO: check chain
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
        result.nftParams = result.transferParams ? (
          await ethCall(
            result.nftContract,
            "encodeParams",
            [result.nftId],
            ABI_encodeParams,
            depositNetwork
          )
        ): '0x0';
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

        let { txId, tokenId, fromChain, toChain, user, nftId, nftParams } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'uint256', value: txId },
          { type: 'uint256', value: tokenId },
          { type: 'uint256', value: fromChain },
          { type: 'uint256', value: toChain },
          { type: 'address', value: user },
          { type: 'uint256[]', value: nftId },
          { type: 'bytes', value: nftParams }
        ])

      default:
        return null
    }
  }
}
