const {
  axios,
  toBaseUnit,
  soliditySha3,
  BN,
  multiCall,
  flatten,
  groupBy,
} = MuonAppUtils;
const AgggregatedOracles = require("./aggregate_oracles");

const APP_CONFIG = {
  chainId: 250,
};

const INPUT_PARAMS = {
    "token": "0xDE12c7959E1a72bbe8a5f7A1dc8f8EeF9Ab011B3",
    "pairs": [
      [
        {
          "exchange": "solidly",
          "chainId": "250",
          "address": "0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0"
        }
      ],
      [
        {
          "exchange": "spirit",
          "chainId": "250",
          "address": "0x8eFD36aA4Afa9F4E157bec759F1744A7FeBaEA0e"
        }
      ],
      [
        {
          "exchange": "spooky",
          "chainId": "250",
          "address": "0xD343b8361Ce32A9e570C1fC8D4244d32848df88B"
        }
      ]
    ]
  };

module.exports = {
  ...AgggregatedOracles,

  APP_NAME: "aggregate_oracles_dei",
  APP_ID: 41,
  config: APP_CONFIG,

  onRequest: async function(request) {
    let {
      method
    } = request;

    let params = INPUT_PARAMS;

    switch (method) {
      case "price":
        let { token, pairs, hashTimestamp, chainId, start, end } = params;
        if (chainId) {
          this.config = { ...this.config, chainId };
        }
        let { price, volume } = await this.tokenVWAP(
          token,
          pairs,
          null,
          start,
          end
        );
        return {
          token: token,
          tokenPrice: price.toString(),
          volume: volume.toString(),
          timestamp: request.data.timestamp,
        };
    }
  },

  hashRequestResult: function (request, result) {
    let {
      method,
    } = request;
    let params = INPUT_PARAMS;
    switch (method) {
      case 'price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, chainId, start, end } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: request.data.timestamp }
        ])
      }
      default:
        return null
    }
  }
};
