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
const ethContractAddress = '0xA0b0AA5D2bd1738504577E1883537C9af3392454'
const bscContractAddress = '0x059ce16319da782e2909c9e15f3232233649a321'
const xdaiContractAddress = '0x059ce16319Da782E2909c9e15f3232233649a321'
const ethNetwork = 'eth'
const bscNetWork = 'bsc'
const xdaiNetwork = 'xdai'
const xDaiChainId = 100
const bscChainId = 56
const ethChainId = 1

const DEPOSIT_LOCK = 'muon-deposit-lock'

module.exports = {
  APP_NAME: 'presale',

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

        // let locked = await this.memRead({
        //   nSign,
        //   'data.name': 'forAddress',
        //   'data.value': forAddress
        // })

        let ethPurchase = await ethCall(
          ethContractAddress,
          'balances',
          [forAddress],
          muonPresaleABI_eth,
          ethNetwork
        )
        let bscPurchase = await ethCall(
          bscContractAddress,
          'balances',
          [forAddress],
          muonPresaleABI,
          bscNetWork
        )

        let xdaiPurchase = await ethCall(
          xdaiContractAddress,
          'balances',
          [forAddress],
          muonPresaleABI,
          xdaiNetwork
        )

        let [tokenList, allowance] = await Promise.all([
          getTokens(),
          getAllowance()
        ])
        if (!Object.keys(tokenList).includes(token))
          throw { message: 'Token not allowed for deposit' }

        token = tokenList[token]
        // token = {
        //   decimals: 18,
        //   address: '0x4Ef4E0b448AC75b7285c334e215d384E7227A2E6',
        //   price: 1
        // }
        // allowance = {
        //   ...allowance,
        //   '0x5629227C1E2542DbC5ACA0cECb7Cd3E02C82AD0a': 20000
        // }
        if (allowance[forAddress] === undefined)
          throw { message: 'address not allowed for deposit' }

        let maxCap = new BN(
          toBaseUnit(allowance[forAddress].toString(), '18').toString()
        )
        ethPurchase = new BN(ethPurchase)
        bscPurchase = new BN(bscPurchase)
        xdaiPurchase = new BN(xdaiPurchase)
        let sum
        switch (chainId) {
          case ethChainId:
            sum = bscPurchase.add(xdaiPurchase)
            break
          case bscChainId:
            sum = ethPurchase.add(xdaiPurchase)
            break
          case xDaiChainId:
            sum = bscPurchase.add(ethPurchase)
            break
          default:
            break
        }
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
        let lock = await this.readNodeMem(
          { 'data.name': DEPOSIT_LOCK, 'data.value': forAddress },
          { distinct: 'owner' }
        )
        if (lock.length !== 1) throw { message: 'Atomic run failed.' }
        return data
      }
      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'deposit': {
        let { chainId } = params
        let { token, tokenPrice, amount, forAddress, addressMaxCap } = result
        const data =
          chainId == 1
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
  }

  // onMemWrite: (req, res) => {
  //   let {
  //     method,
  //     data: {
  //       params: { forAddress, amount },
  //       result: { time }
  //     }
  //   } = req
  //   switch (method) {
  //     case 'deposit': {
  //       return {
  //         ttl: 6 * 60,
  //         data: [{ name: 'forAddress', type: 'address', value: forAddress }]
  //       }
  //     }
  //     default:
  //       return null
  //   }
  // }
}
