const { soliditySha3 } = MuonAppUtils
const { axios, toBaseUnit, soliditySha3 } = MuonAppUtils

const COINDESK_API = 'https://api.coindesk.com/v1/bpi/currentprice/BTC.json'

function getBtcPrice() {
  return axios.get(COINDESK_API).then(({ data }) => data)
}
const getTimestamp = () => Math.floor(Date.now() / 1000)

module.exports = {
  APP_NAME: 'sample',

  onRequest: async function (method, params) {
    console.log({ method, params })
    switch (method) {
      case 'test':
        return 1 + Math.random()
      case 'currentDate':
        return new Date().toDateString()
      case 'btc_price':
        let result = await getBtcPrice()
        let price = toBaseUnit(
          result.bpi.USD.rate_float.toString(),
          18
        ).toString()
        let time = getTimestamp()

        return {
          time,
          price,
          price_float: result.bpi.USD.rate_float
        }
      default:
        return 'test done'
    }
  },

  hashRequestResult: (request, result) => {
    console.log(result)
    switch (request.method) {
      case 'test':
        return Math.floor(result).toString()

      case 'currentDate':
        return soliditySha3([{ type: 'string', value: result }])

      case 'btc_price':
        let hash = soliditySha3([
          { type: 'uint256', value: request.data.result.time },
          { type: 'uint256', value: result.price }
        ])
        return hash
      default:
        return null
    }
  }
}
