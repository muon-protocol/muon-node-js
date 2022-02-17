const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 13

// Random seed function
// More Info: 
// https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
Math.seed = function(s) {
    var mask = 0xffffffff;
    var m_w  = (123456789 + s) & mask;
    var m_z  = (987654321 - s) & mask;

    return function() {
      m_z = (36969 * (m_z & 65535) + (m_z >>> 16)) & mask;
      m_w = (18000 * (m_w & 65535) + (m_w >>> 16)) & mask;

      var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
      result /= 4294967296;
      return result;
    }
}

function getRandomNumber(seed, min, max){
  var rngFunction = Math.seed(seed);
  return Math.floor(rngFunction() * (max-min)) + min;
}

module.exports = {
  APP_NAME: 'test_rng',

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'randint':
        let { address, min, max} = params

        /*
        We are using the timestamp as the seed.
        To make it more secure, we can use another deterministic random number. For example:
        - Solana’s block hash at timestamp+1 second
        - BTC price at timestamp+1 second
        …
        */

        let seed = request.data.timestamp;
        
        // all nodes will use the same seed and the random
        // number will be the same on all nodes
        let randomNumber = getRandomNumber(seed, 
          parseInt(min), parseInt(max)
        );

        return {
          appId: APP_ID,
          address,
          number: randomNumber
        }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: (request, result) => {
    let { method } = request;
    switch (method) {
      case 'randint':
        let { address } = result;
        return soliditySha3([
          { type: 'uint32', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: result.number}
        ])

      default:
        break
    }
  }
}
