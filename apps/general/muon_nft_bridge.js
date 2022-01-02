const { soliditySha3, ethCall, ethGetNftInfo, BN, Web3 } = MuonAppUtils

export const MuonNFTBridge = {
  4: '0x4cA69fB6394f248F647480da6e0398FB9B4FbE62',
  97: '0x2FD1006AAD539fB96C1D00A7E800700046069bDa',
  80001: '0x9C8e7E17738C2230154028e6E92AC73110e4530a'
}

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

const ABI_sourceInfo = [
  {
    inputs: [],
    name: 'sourceInfo',
    outputs: [
      {
        internalType: 'uint256',
        name: '_sourceChain',
        type: 'uint256'
      },
      {
        internalType: 'address',
        name: '_sourceContract',
        type: 'address'
      }
    ],
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

        let [currentId, token] = await Promise.all([
          await ethCall(
            sourceBridge,
            'getTokenId',
            [mainTokenAddress],
            ABI_getTokenId,
            mainNetwork
          ),
          await ethGetNftInfo(mainTokenAddress, mainNetwork)
        ])

        let sourceChain = mainNetwork
        if (currentId != 0) {
          let mainContract = `0x${new BN(currentId).toString(16)}`

          let sourceInfo = await ethCall(
            mainTokenAddress,
            'sourceInfo',
            [],
            ABI_sourceInfo,
            mainNetwork
          )
          console.log(sourceInfo)
          if (
            Web3.utils.toChecksumAddress(mainContract) ===
            Web3.utils.toChecksumAddress(sourceContractToken)
          ) {
            sourceChain = sourceChainToken
          }
        }

        let result = {
          token: {
            symbol: token.symbol.replace('μ-', ''),
            name: token.name.replace('Muon ', '')
          },
          tokenId: currentId == 0 ? mainTokenAddress : currentId,
          sourceChain
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
          { type: 'uint256[]', value: nftId }
        ])
      }
      case 'addBridgeToken': {
        let { token, tokenId, sourceChain } = result

        return soliditySha3([
          { type: 'uint256', value: tokenId },
          { type: 'uint256', value: sourceChain },
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
