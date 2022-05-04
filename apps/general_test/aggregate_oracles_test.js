require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const AggregateOracles = dynamicExtend(
  class {},
  require('../general/aggregate_oracles')
)

// ————————- POLYGON——————————-
// DEI-DEUS LP  0x2Bc3ce6D7cfc0B476E60aDaA1B27DE76DB95EE4e
// DEI-USDC LP  0xD4F9134ba896FB6901CD6A5EA4EEB683eb1c15c6
// DEUS-MATIC LP  0x6152943b506211ce1FA872702a1b0bc594Cfa2d2

// ————————- UniSwap——————————-
// DEI-DEUS LP  0xd6dd359B8C9d18CCB3FE8627060F88D1776d2993
// DEI-USDC LP  0x6870F9b4DD5d34C7FC53D0d85D9dBd1aAB339BF7
// DEUS-ETH LP  0x367E2D443988E4b222FBFdAFDb35eeB7ddA9FBB7

const app = new AggregateOracles()

const testLP = async (params, token, tokenName) => {
  let method = 'lp_price'

  return app
    .onRequest({
      method,
      data: {
        params
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log(`\n \nResult for LP_PRICE ${tokenName}: ${token}`)
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

const testPrice = async (params, token, tokenName) => {
  let method = 'price'

  return app
    .onRequest({
      method,
      data: {
        params
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log(`\n \nResult for PRICE ${tokenName}: ${token}`)
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

const tokenName = 'DEUS'
const token = '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44' // token:deus
const example_1 = {
  token,
  pairs: [
    [
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058' // DEI/DEUS
      },
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' // DEI/USDC
      }
    ],
    [
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0xdDC92fcEd95e913728CBc8f197A4E058062Bd4b6' // DEI/DEUS
      },
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' // DEI/USDC
      }
    ],
    [
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x2599eba5fd1e49f294c76d034557948034d6c96e' // WFTM/DEUS
      },
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0xe7e90f5a767406eff87fdad7eb07ef407922ec1d' // USDC/WFTM
      }
    ],
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0x367E2D443988E4b222FBFdAFDb35eeB7ddA9FBB7' // WETH/DEUS
      },
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc' //  WETH/USDC
      }
    ]
  ]
}

const tokenName2 = 'WETH'
const token2 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' //WETH
const example_2 = {
  token: token2,
  pairs: [
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11' // WETH/DAI
      }
    ],
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xBb2b8038a1640196FbE3e38816F3e67Cba72D940' // WETH/WBTC
      },
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0x231B7589426Ffe1b75405526fC32aC09D44364c4' //WBTC/DAI
      }
    ]
  ]
}

const tokenNameLP = 'vAMM-DEI/DEUS'
const tokenLP = '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058' // vAMM-DEI/DEUS
const LP_Params = {
  token: tokenLP,
  chainId: '250',
  pairs0: [
    [
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0' // DEI-USDC
      }
    ],
    [
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' // DEI-USDC
      }
    ]
  ],
  pairs1: [
    [
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058' //DEI - DEUS
      },
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' //DEI - USDC
      }
    ],
    [
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0xdDC92fcEd95e913728CBc8f197A4E058062Bd4b6' //DEI-DEUS
      },
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0' // DEI-USDC
      }
    ]
  ]
}

const tokenNameLP2 = 'DEUS/WETH'
const tokenLP2 = '0x367E2D443988E4b222FBFdAFDb35eeB7ddA9FBB7' // DEUS/WETH
const LP_Params2 = {
  token: tokenLP2,
  chainId: '1',
  pairs0: [
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11' // WETH/DAI
      }
    ],
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xBb2b8038a1640196FbE3e38816F3e67Cba72D940' // WETH/WBTC
      },
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0x231B7589426Ffe1b75405526fC32aC09D44364c4' //WBTC/DAI
      }
    ]
  ],
  pairs1: [
    [
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058' //DEI - DEUS
      },
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e' //DEI - USDC
      }
    ],
    [
      {
        exchange: 'spirit',
        chainId: '250',
        address: '0xdDC92fcEd95e913728CBc8f197A4E058062Bd4b6' //DEI-DEUS
      },
      {
        exchange: 'solidly',
        chainId: '250',
        address: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0' // DEI-USDC
      }
    ],
    [
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0x367E2D443988E4b222FBFdAFDb35eeB7ddA9FBB7' // WETH/DEUS
      },
      {
        exchange: 'uniswap',
        chainId: '1',
        address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc' //  WETH/USDC
      }
    ]
  ]
}
testLP(LP_Params, tokenLP, tokenNameLP)
testLP(LP_Params2, tokenLP2, tokenNameLP2)

testPrice(example_1, token, tokenName)
testPrice(example_2, token2, tokenName2)
