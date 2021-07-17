const { axios, toBaseUnit, soliditySha3, BN } = MuonAppUtils
const eth = require('../utils/node-utils/eth')
const { muonPresaleABI_eth, muonPresaleABI } = require('./abi')

const getTimestamp = () => Math.floor(Date.now() / 1000)

function getTokens() {
  return axios
    .get('https://app.deus.finance/prices.json')
    .then(({ data }) => data)
}

function getAllowance() {
  return axios
    .get('https://app.deus.finance/muon-presale.json')
    .then(({ data }) => data)
}

module.exports = {
  APP_NAME: 'presale',

  onRequest: async function (method, params = {}) {
    switch (method) {
      case 'deposit': {
        let { token, amount, forAddress, chainId } = params
        let time = getTimestamp()

        if (!token) throw { message: 'Invalid token' }
        if (!amount) throw { message: 'Invalid deposit amount' }
        if (!forAddress) throw { message: 'Invalid sender address' }
        if (!chainId) throw { message: 'Invalid chainId' }

        let ethPurchase = await eth.call(
          '0xA0b0AA5D2bd1738504577E1883537C9af3392454',
          'balances',
          [forAddress],
          muonPresaleABI_eth,
          'eth'
        )
        let bscPurchase = await eth.call(
          '0x263e4Bf4df48f27aD8E18f7788cB78c7Ee4BEc07',
          'balances',
          [forAddress],
          muonPresaleABI,
          'bsctest'
        )
        let [tokenList, allowance] = await Promise.all([
          getTokens(),
          getAllowance()
        ])

        // if (!Object.keys(tokenList).includes(token))
        //   throw { message: 'Token not allowed for deposit' }

        // token = tokenList[token]
        token = {
          decimals: 18,
          address: '0x4Ef4E0b448AC75b7285c334e215d384E7227A2E6',
          price: 1
        }
        allowance = {
          ...allowance,
          '0x5629227C1E2542DbC5ACA0cECb7Cd3E02C82AD0a': 20000
        }
        if (allowance[forAddress] === undefined)
          throw { message: 'address not allowed for deposit' }

        let maxCap = new BN(
          toBaseUnit(allowance[forAddress].toString(), '18').toString()
        )
        ethPurchase = new BN(ethPurchase)
        bscPurchase = new BN(bscPurchase)
        let sum = ethPurchase.add(bscPurchase)
        let finalMaxCap = maxCap.sub(sum)
        finalMaxCap = finalMaxCap.toString()

        const data =
          chainId == 1
            ? {
                token: token.address,
                tokenPrice: toBaseUnit(token.price.toString(), 18).toString(),
                amount,
                time,
                forAddress,
                addressMaxCap: finalMaxCap
              }
            : {
                token: token.address,
                tokenPrice: toBaseUnit(token.price.toString(), 18).toString(),
                amount,
                time,
                forAddress,
                addressMaxCap: [finalMaxCap, chainId]
              }

        return data
      }
      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    switch (request.method) {
      case 'deposit': {
        let { token, tokenPrice, amount, forAddress, addressMaxCap } = result
        const data =
          addressMaxCap[1] == 1
            ? soliditySha3([
                { type: 'address', value: token },
                { type: 'uint256', value: tokenPrice },
                { type: 'uint256', value: amount },
                { type: 'uint256', value: request.data.result.time },
                { type: 'address', value: forAddress },
                { type: 'uint256', value: addressMaxCap }
              ])
            : soliditySha3([
                { type: 'address', value: token },
                { type: 'uint256', value: tokenPrice },
                { type: 'uint256', value: amount },
                { type: 'uint256', value: request.data.result.time },
                { type: 'address', value: forAddress },
                { type: 'uint256', value: addressMaxCap[0] },
                { type: 'uint256', value: addressMaxCap[1] }
              ])
        return data
      }
      default:
        return null
    }
  },
  memWrite: (req, res) => {
    let {
      method,
      data: {
        params: { forAddress, amount },
        result: { time }
      }
    } = req
    switch (method) {
      case 'deposit': {
        return {
          timeout: 5 * 60,
          data: { forAddress, amount, time },
          hash: soliditySha3([
            { type: 'address', value: forAddress },
            { type: 'uint256', value: amount },
            { type: 'uint256', value: time }
          ])
        }
      }
      default:
        return null
    }
  }
}
