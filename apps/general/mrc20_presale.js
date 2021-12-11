const { axios, toBaseUnit, soliditySha3, BN, recoverTypedMessage, ethCall } =
  MuonAppUtils

function getTokens() {
  return axios
    .get('https://app.deus.finance/prices.json')
    .then(({ data }) => data)
}

const allocation = {
  '0x5629227C1E2542DbC5ACA0cECb7Cd3E02C82AD0a': 1000,
  '0x8b9C5d6c73b4d11a362B62Bd4B4d3E52AF55C630': 500,
  '0xbb49a68c8EA9C2374082B738A7297c28EF3Fda26': 20000,
  '0x3Be0B18d954DF829dE5E7d968002B856bB89f104': 200000
}

const ABI_balances = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'balances',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]
// TODO: uncommect lock code
// TODO: change to main network

const chainMap = {
  MAINNET: 4,
  BSC: 97,
  MATIC: 80001
}
const MRC20Presale = {
  [chainMap.MAINNET]: '0x1E88F065728cc11dd1FE906B388C4f8C62d5f0Fe',
  [chainMap.BSC]: '0x1E88F065728cc11dd1FE906B388C4f8C62d5f0Fe',
  [chainMap.MATIC]: '0xCcde36b16e5Ef4437Ded551281B98f69AaEB13fb'
}

const DEPOSIT_LOCK = 'mrc20-deposit-lock'

module.exports = {
  APP_NAME: 'mrc20_presale',
  APP_ID: 6,

  // onArrive: async function (request) {
  //   const {
  //     method,
  //     data: { params }
  //   } = request
  //   switch (method) {
  //     case 'deposit':
  //       const { forAddress } = params
  //       let memory = [
  //         { type: 'uint256', name: DEPOSIT_LOCK, value: forAddress }
  //       ]
  //       let lock = await this.readNodeMem({
  //         'data.name': DEPOSIT_LOCK,
  //         'data.value': forAddress
  //       })
  //       if (lock) {
  //         throw {
  //           message: {
  //             message: `Address [${forAddress}] locked for for 6 minutes.`,
  //             lockTime: 6 * 60,
  //             expireAt: lock.expireAt
  //           }
  //         }
  //       }
  //       await this.writeNodeMem(memory, 6 * 60)
  //       return

  //     default:
  //       break
  //   }
  // },

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'deposit':
        let {
          token,
          forAddress,
          amount,
          sign,
          presaleToken,
          chainId,
          hashTimestamp
        } = params
        if (!token) throw { message: 'Invalid token' }
        if (!presaleToken) throw { message: 'Invalid presale token' }
        if (!amount) throw { message: 'Invalid deposit amount' }
        if (!forAddress) throw { message: 'Invalid sender address' }
        if (!sign) throw { message: 'Request signature undefined' }
        if (!chainId) throw { message: 'Invalid chainId' }

        if ((token === 'busd' || token === 'bnb') && chainId != chainMap.BSC)
          throw { message: 'Token and chain is not matched' }

        if (allocation[forAddress] === undefined)
          throw { message: 'address not allowed for deposit' }

        let tokenList = await getTokens()
        if (!Object.keys(tokenList).includes(token.toLowerCase()))
          throw { message: 'Token not allowed for deposit' }
        token = tokenList[token.toLowerCase()]

        let typedData = {
          types: {
            EIP712Domain: [{ name: 'name', type: 'string' }],
            Message: [{ type: 'address', name: 'forAddress' }]
          },
          domain: { name: 'MRC20 Presale' },
          primaryType: 'Message',
          message: { forAddress: forAddress }
        }

        let signer = recoverTypedMessage({ data: typedData, sig: sign }, 'v4')

        if (signer.toLowerCase() !== forAddress.toLowerCase())
          throw { message: 'Request signature mismatch' }

        let maxCap = new BN(
          toBaseUnit(
            allocation[forAddress].toString(),
            presaleToken.decimals
          ).toString()
        )
        let allPurchase = {}
        for (let index = 0; index < Object.keys(chainMap).length; index++) {
          const chainId = chainMap[Object.keys(chainMap)[index]]
          let purchase = await ethCall(
            MRC20Presale[chainId],
            'balances',
            [forAddress],
            ABI_balances,
            chainId
          )
          allPurchase = { ...allPurchase, [chainId]: new BN(purchase) }
        }
        let sum = Object.keys(allPurchase)
          .filter((chain) => chain != chainId)
          .reduce((sum, chain) => sum.add(allPurchase[chain]), new BN(0))
        let finalMaxCap = maxCap.sub(sum).toString()
        let tokenPrice = toBaseUnit(
          token.price.toString(),
          token.decimals
        ).toString()
        let presaleTokenPrice = toBaseUnit(
          presaleToken.price.toString(),
          presaleToken.decimals
        ).toString()
        const data = {
          token: token.address,
          presaleTokenPrice,
          forAddress,
          extraParameters: [
            finalMaxCap,
            chainId,
            tokenPrice,
            amount,
            ...(hashTimestamp ? [request.data.timestamp] : [])
          ]
        }

        // let lock = this.readNodeMem(
        //   { 'data.name': DEPOSIT_LOCK, 'data.value': forAddress },
        //   { distinct: 'owner' }
        // )
        // if (lock.length !== 1) throw { message: 'Atomic run failed.' }

        return data

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
      case 'deposit':
        let { hashTimestamp } = params
        let { token, presaleTokenPrice, forAddress, extraParameters } = result

        return soliditySha3([
          { type: 'address', value: token },
          { type: 'uint256', value: presaleTokenPrice },
          { type: 'uint256', value: extraParameters[3] },
          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : []),
          { type: 'address', value: forAddress },
          { type: 'uint256', value: extraParameters[0] },
          { type: 'uint256', value: extraParameters[1] },
          { type: 'uint256', value: extraParameters[2] },
          { type: 'uint8', value: this.APP_ID }
        ])

      default:
        return null
    }
  }
}
