const { axios, toBaseUnit, soliditySha3, BN, recoverTypedMessage, ethCall } =
  MuonAppUtils

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
  XDAI: 100,
  POLYGON: 137
}
const muonPresale = {
  [chainMap.ETH]: '0xA0b0AA5D2bd1738504577E1883537C9af3392454',
  [chainMap.BSC]: '0x059ce16319da782e2909c9e15f3232233649a321',
  [chainMap.XDAI]: '0x059ce16319Da782E2909c9e15f3232233649a321',
  [chainMap.POLYGON]: '0x6d8f193469731f11b51b71ef49e4adc754ee2ce8'
}

const DEPOSIT_LOCK = 'muon-deposit-lock'

module.exports = {
  APP_NAME: 'presale',
  APP_ID: 8,

  onArrive: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'deposit':
        let { forAddress } = params
        let memory = [
          { type: 'uint256', name: DEPOSIT_LOCK, value: forAddress }
        ]
        let lock = await this.readNodeMem({
          'data.name': DEPOSIT_LOCK,
          'data.value': forAddress
        })
        if (lock)
          throw {
            message: {
              message: `Address [${forAddress}] locked for for 6 minutes.`,
              lockTime: 6 * 60,
              expireAt: lock.expireAt
            }
          }
        await this.writeNodeMem(memory, 6 * 60)
        return
    }
  },

  onRequest: async function (request) {
    let {
      method,
      nSign,
      data: { params }
    } = request

    switch (method) {
      case 'deposit': {
        let { token, amount, forAddress, chainId, time, sign } = params
        let currentTime = getTimestamp()

        if (!chainId || chainId != chainMap.POLYGON)
          throw { message: 'Invalid chainId' }
        if (!time) throw { message: 'invalid deposit time' }
        if (currentTime - time > 5*60)
          throw {
            message:
              'time diff is greater than 5 min. check your system time.'
          }
        if (!token) throw { message: 'Invalid token' }
        if (!amount) throw { message: 'Invalid deposit amount' }
        if (!forAddress) throw { message: 'Invalid sender address' }
        if (!sign) throw { message: 'Request signature undefined' }
        else {
          let typedData = {
            types: {
              EIP712Domain: [{ name: 'name', type: 'string' }],
              Message: [
                { type: 'uint256', name: 'time' },
                { type: 'address', name: 'forAddress' }
              ]
            },
            domain: { name: 'MUON Presale' },
            primaryType: 'Message',
            message: { time: time, forAddress: forAddress }
          }

          let signer = recoverTypedMessage({ data: typedData, sig: sign }, 'v4')

          if (signer.toLowerCase() !== forAddress.toLowerCase())
            throw { message: 'Request signature mismatch' }
        }

        let [tokenList, allowance] = await Promise.all([
          getTokens(),
          getAllowance()
        ])
        if (!Object.keys(tokenList).includes(token))
          throw { message: 'Token not allowed for deposit' }

        token = tokenList[token]

        if (allowance[forAddress] === undefined)
          throw { message: 'address not allowed for deposit' }

        let maxCap = toBaseUnit(
          allowance[forAddress].toString(),
          '18'
        ).toString()

        let lock = await this.readNodeMem(
          { 'data.name': DEPOSIT_LOCK, 'data.value': forAddress },
          { distinct: 'owner' }
        )
        if (lock.length !== 1) throw { message: 'Atomic run failed.' }
        return {
          token: token.address,
          tokenPrice: toBaseUnit(token.price.toString(), 18).toString(),
          amount,
          time,
          forAddress,
          addressMaxCap: [maxCap, chainId]
        }
      }
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

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'deposit': {
        let { token, tokenPrice, amount, forAddress, addressMaxCap } = result
        return soliditySha3([
          { type: 'address', value: token },
          { type: 'uint256', value: tokenPrice },
          { type: 'uint256', value: amount },
          { type: 'uint256', value: request.data.result.time },
          { type: 'address', value: forAddress },
          { type: 'uint256', value: addressMaxCap[0] },
          { type: 'uint256', value: addressMaxCap[1] },
          { type: 'uint8', value: this.APP_ID }
        ])
      }
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
