const { axios, toBaseUnit, soliditySha3, timeout } = MuonAppUtils

const COINDESK_API = 'https://api.coindesk.com/v1/bpi/currentprice/BTC.json'

function getBtcPrice() {
  return axios.get(COINDESK_API).then(({ data }) => data)
}
const getTimestamp = () => Math.floor(Date.now() / 1000)

const LOCK_NAME = "sample-app-lock-user"

module.exports = {
  APP_NAME: 'sample',
  isService: true,

  /**
   * Request arrival hook
   * Runs only on the first node
   *
   * @param request
   * @returns {Promise<void>}
   */
  onArrive: async function (request) {
    let {method, data: {params}} = request;
    switch (method) {
      case 'lock':
        let {user} = params;

        // looking for data in memory
        let lock = await this.readNodeMem({"data.name": LOCK_NAME, "data.value": user})
        if (lock) {
          throw {message: `User [${user}] locked for a moment`}
        }

        // Write to memory
        let memory = [
          {type: 'uint256', name: LOCK_NAME, value: user}
        ]
        await this.writeNodeMem(memory, 120);

        // wait for memory write confirmation
        await timeout(1000);

        break;
    }
  },

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'test_speed': {
        return 'speed test done.'
      }
      case 'lock':
        let { user } = params

        // You can check for atomic run of the lock method
        let lock = await this.readNodeMem({"data.name": LOCK_NAME, "data.value": user}, {distinct: "owner"})
        if(lock.length === 0) {
          throw {message: 'Memory write not confirmed.'}
        }
        else if(lock.length > 1) {
          throw {message: 'Atomic run failed.'}
        }

        return 'lock done.'

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
    // console.log(result)
    switch (request.method) {
      case 'test_speed':
      case 'lock':
        return result
      case 'btc_price':
        let hash = soliditySha3([
          { type: 'uint256', value: request.data.result.time },
          { type: 'uint256', value: result.price }
        ])
        return hash
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  },

  /**
   * store data on request confirm
   */
  onMemWrite: (req, res) => {
    if (req.method === 'lock') {
      let {
        data: {
          params: { user }
        }
      } = req
      return {
        ttl: 10,
        data: [{ name: 'lock', type: 'string', value: user }]
      }
    }
  }
}
