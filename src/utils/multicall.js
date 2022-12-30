import { Multicall } from 'ethereum-multicall'
import { getWeb3 } from './eth.js'

async function multiCall(chainId, contractCallContext, tryAggregate = false, multicallCustomContractAddress) {
  try {
    const web3 = await getWeb3(chainId)
    const multicall = new Multicall({
      ...(!!multicallCustomContractAddress ? {multicallCustomContractAddress} : {}),
      web3Instance: web3,
      tryAggregate
    })
    let { results } = await multicall.call(contractCallContext)
    results = contractCallContext.map((item) => ({
      reference: item.reference,
      contractAddress: item.contractAddress,
      context: item.context,
      callsReturnContext: results[item.reference]['callsReturnContext'].map(
        (callReturn) => ({
          ...callReturn,
          returnValues: callReturn['returnValues'].map((value) => {
            if (typeof value === 'object' && 'hex' in value)
              return web3.utils.hexToNumberString(value.hex)
            else return value
          })
        })
      )
    }))
    return results
  } catch (error) {
    throw {
      message: `MULTICALL_ERROR. ${error.message}`,
      error: error.message
    }
  }
}

export { multiCall }

// Example

// const contractCallContext = [
//     {
//       reference: 'BloodToken',
//       contractAddress: '0xc3b99c2a46b8DC82C96B8b61ED3A4c5E271164D7',
//       abi: [
//         {
//           inputs: [
//             { internalType: 'address', name: 'account', type: 'address' }
//           ],
//           name: 'balanceOf',
//           outputs: [
//             { internalType: 'uint256', name: '', type: 'uint256' }
//           ],
//           stateMutability: 'view',
//           type: 'function'
//         }
//       ],
//       calls: [
//         {
//           reference: 'bloodTokenBalance',
//           methodName: 'balanceOf',
//           methodParameters: [account]
//         }
//       ]
//     },
//     {
//       reference: 'MuonSwapPair',
//       contractAddress: '0xC233Cce22a0E7a5697D01Dcc6be93DA14BfB3761',
//       abi: [
//         {
//           inputs: [
//             { internalType: 'address', name: 'account', type: 'address' }
//           ],
//           name: 'balanceOf',
//           outputs: [
//             { internalType: 'uint256', name: '', type: 'uint256' }
//           ],
//           stateMutability: 'view',
//           type: 'function'
//         },
//         {
//           inputs: [],
//           name: 'symbol',
//           outputs: [{ internalType: 'string', name: '', type: 'string' }],
//           stateMutability: 'view',
//           type: 'function'
//         }
//       ],
//       calls: [
//         {
//           reference: 'muonSwapBalance',
//           methodName: 'balanceOf',
//           methodParameters: [account]
//         },
//         {
//           reference: 'muonSwapSymbol',
//           methodName: 'symbol'
//         }
//       ]
//     }
//   ]
