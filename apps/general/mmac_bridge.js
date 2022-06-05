const { ethCall, soliditySha3 } = MuonAppUtils

const ABI_txs = [
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "txs",
      "outputs": [
        {
          "internalType": "address",
          "name": "wallet",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "txId",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    }
]


module.exports = {
  APP_NAME: 'mmac_bridge',
  APP_ID: 33,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'burn':
        let { contractAddress, txId } = params
        //TODO: check chain
        if (!contractAddress) throw { message: 'Invalid contarct address' }
        if (!txId) throw { message: 'Invalid deposit Tx Id' }
        const network = 80001
        let result = await ethCall(
          contractAddress,
          'txs',
          [txId],
          ABI_txs,
          network
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
      case 'burn':

        let { txId, wallet } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'uint256', value: txId },
          { type: 'address', value: wallet }
        ])

      default:
        return null
    }
  }
}
