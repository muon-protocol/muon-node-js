const { axios, toBaseUnit, soliditySha3, BN, ecRecover, ethCall } = MuonAppUtils

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

const muonPresaleABI_eth = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'balances',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const muonPresaleABI = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'balances',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const xDaiChainId = 77
const bscChainId = 97

module.exports = {
  APP_NAME: 'presale',

  onRequest: async function (request) {
    let {
      method,
      nSign,
      data: { params }
    } = request
    switch (method) {
      case 'deposit': {
        try {
          let { token, amount, forAddress, chainId, time, sign } = params
          console.log({ token, amount, forAddress, chainId, time, sign })
          let currentTime = getTimestamp()

          if (!chainId) throw { message: 'Invalid chainId' }
          if (!time) throw { message: 'invalid deposit time' }
          if (currentTime - time > 20)
            throw {
              message:
                'time diff is grater than 20 seconds. check your system time.'
            }
          if (!token) throw { message: 'Invalid token' }
          if (!amount) throw { message: 'Invalid deposit amount' }
          if (!forAddress) throw { message: 'Invalid sender address' }
          if (!sign) throw { message: 'Request signature undefined' }
          if (token === 'xdai' && chainId != xDaiChainId)
            throw { message: 'Token and chain is not matched' }
          if ((token === 'busd' || token === 'bnb') && chainId != bscChainId)
            throw { message: 'Token and chain is not matched' }
          else {
            console.log('check hash')
            let hash = soliditySha3([
              { type: 'uint256', value: time },
              { type: 'address', value: forAddress }
            ])
            let signer = ecRecover(hash, sign)
            if (signer !== forAddress)
              throw { message: 'Request signature mismatch' }
          }

          let locked = await this.memRead({
            nSign,
            'data.name': 'forAddress',
            'data.value': forAddress
          })
          console.log('locked', locked)
          if (!!locked) {
            throw {
              message: `deposit from address ${forAddress} has been locked for 5 minutes.`
            }
          }
          console.log('object')
          let ethPurchase = await ethCall(
            '0xA0b0AA5D2bd1738504577E1883537C9af3392454',
            'balances',
            [forAddress],
            muonPresaleABI_eth,
            'eth'
          )
          let bscPurchase = await ethCall(
            '0x263e4Bf4df48f27aD8E18f7788cB78c7Ee4BEc07',
            'balances',
            [forAddress],
            muonPresaleABI,
            'bsctest'
          )
          let sokolPurchase = await ethCall(
            '0x3f591D4a4D0B03A0C9Ff9A78E2aeE2CA3F40f423',
            'balances',
            [forAddress],
            muonPresaleABI,
            'sokol'
          )
          console.log(sokolPurchase)
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
          sokolPurchase = new BN(sokolPurchase)
          let sum = ethPurchase.add(bscPurchase)
          sum = sum.add(sokolPurchase)
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
        } catch (error) {
          console.log(error)
        }
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
  onMemWrite: (req, res) => {
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
          ttl: 5 * 60,
          data: [{ name: 'forAddress', type: 'address', value: forAddress }]
        }
      }
      default:
        return null
    }
  }
}
