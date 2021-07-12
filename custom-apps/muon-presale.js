const {axios, toBaseUnit, soliditySha3} = MuonAppUtils;

const getTimestamp = () => Math.floor(Date.now() / 1000)

function getTokens() {
  return axios.get('https://app.deus.finance/prices.json')
    .then(({data}) => data)
}

function getAllowance() {
  return axios.get('https://app.deus.finance/muon-presale.json')
    .then(({data}) => data)
}

module.exports = {
  APP_NAME: 'presale',

  onRequest: async function (method, params={}) {
    switch (method) {
      case 'deposit':{
        let {token, amount, forAddress,} = params;
        let time = getTimestamp();

        if (!token)
          throw {message: 'Invalid token'}
        if (!amount)
          throw {message: 'Invalid deposit amount'}
        if (!forAddress)
          throw {message: 'Invalid sender address'}

        let [tokenList, allowance] = await Promise.all([getTokens(), getAllowance()])

        if(!Object.keys(tokenList).includes(token))
          throw {message: 'Token not allowed for deposit'}

        token = tokenList[token]

        if(allowance[forAddress] === undefined)
          throw {message: 'address not allowed for deposit'}

        return {
          token: token.address,
          tokenPrice: toBaseUnit(token.price.toString(), 18).toString(),
          amount,
          time,
          forAddress,
          addressMaxCap: toBaseUnit(allowance[forAddress].toString(), '18').toString(),
        }
      }
      default:
        throw {message: `Unknown method ${params}`}
    }
  },

  hashRequestResult: (request, result) => {
    switch (request.method) {
      case 'deposit': {
        let {token, tokenPrice, amount, forAddress, addressMaxCap} = result;
        return soliditySha3([
          {type: 'address', value: token},
          {type: 'uint256', value: tokenPrice},
          {type: 'uint256', value: amount},
          {type: 'uint256', value: request.data.result.time},
          {type: 'address', value: forAddress},
          {type: 'uint256', value: addressMaxCap},
        ]);
      }
      default:
        return null;
    }
  },
  memWrite: (req, res) => {
    let {
      method,
      data:{
        params: {forAddress, amount},
        result: {time}
      }
    } = req;
    switch (method) {
      case 'deposit': {
        return {
          timeout: 5 * 60,
          data: {forAddress, amount, time},
          hash: soliditySha3([
            {type: 'address', value: forAddress},
            {type: 'uint256', value: amount},
            {type: 'uint256', value: time},
          ])
        }
      }
      default:
        return null;
    }
  }
}
