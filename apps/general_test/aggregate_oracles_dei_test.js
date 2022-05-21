require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { dynamicExtend } = require('../../core/utils')
const AggregateOracles = dynamicExtend(
  class {},
  require('../general/aggregate_oracles_dei')
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

const testPrice = async (tokenName) => {
  let method = 'price'

  return app
    .onRequest({
      method,
      data: {
      }
    })
    .then(({ tokenPrice, volume }) => {
      console.log(`\n \nResult for PRICE ${tokenName}`)
      console.log({ tokenPrice, volume })
    })
    .catch((error) => console.log(error))
}

const example_1 = {
}

testPrice(example_1, 'DEI')
