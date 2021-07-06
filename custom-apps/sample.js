const {axios, toBaseUnit, soliditySha3} = MuonAppUtils;

const COINDESK_API = 'https://api.coindesk.com/v1/bpi/currentprice/BTC.json'

function getBtcPrice(){
  return axios.get(COINDESK_API).then(({data}) => data);
}
const getTimestamp = () => Math.floor(Date.now() / 1000)

module.exports = {
  APP_NAME: 'sample',

  onRequest: async function (method, params) {
    console.log({method, params})
    switch (method) {
      case "btc_price":
        let result = await getBtcPrice()
        let price = toBaseUnit(result.bpi.USD.rate_float.toString(), 18).toString()
        let time = getTimestamp()

        return {
          time,
          price,
          price_float: result.bpi.USD.rate_float
        }
      default:
        return "test done"
    }
  },

  hashRequestResult: (request, result) => {
    switch (request.method) {
      case "btc_price":
        let hash = soliditySha3([
          {type: 'uint256', value: request.data.result.time},
          {type: 'uint256', value: result.price},
        ]);
        return hash;
      default:
        throw {message: `Unknown method: ${request.method}`}
    }
  }
}
