const { soliditySha3, BN, ethCall } = MuonAppUtils

const muonPresaleABI = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'balances',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const chainMap = {
  ETH: 1,
  BSC: 56,
  XDAI: 100
}
const muonPresale = {
  [chainMap.ETH]: '0xA0b0AA5D2bd1738504577E1883537C9af3392454',
  [chainMap.BSC]: '0x059ce16319da782e2909c9e15f3232233649a321',
  [chainMap.XDAI]: '0x059ce16319Da782E2909c9e15f3232233649a321'
}

module.exports = {
  APP_NAME: 'deus_presale_claim',
  APP_ID: 8,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'claim':
        let { address } = params
        if (!address) throw { message: 'Invalid address' }

        let allPurchase = {}
        for (let index = 0; index < Object.keys(chainMap).length; index++) {
          const chainId = chainMap[Object.keys(chainMap)[index]]

          let purchase = await ethCall(
            muonPresale[chainId],
            'balances',
            [address],
            muonPresaleABI,
            chainId
          )
          allPurchase = { ...allPurchase, [chainId]: new BN(purchase) }
        }
        let sum = Object.keys(allPurchase).reduce(
          (sum, chain) => sum.add(allPurchase[chain]),
          new BN(0)
        )
        return {
          address,
          sum: sum.toString()
        }
      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request
    switch (method) {
      case 'claim': {
        const { address, sum } = result
        return soliditySha3([
          { type: 'address', value: address },
          { type: 'uint256', value: sum },
          { type: 'uint8', value: this.APP_ID }
        ])
      }
      default:
        return null
    }
  }
}
