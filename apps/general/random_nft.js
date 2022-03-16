const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 14
const MIN = 1;
const MAX = 20;

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
  APP_NAME: 'random_nft',

  onRequest: async (request) => {
    let {
      method,
      data: { params }
    } = request
    switch (method) {
      case 'randint':
        let { address, nftId, blockHash, blockNumber, txHash} = params;

        /*
        We are int(blockHash+nftId) as the seed to generate a deterministic
        random number
        */

        //TODO: validate that blockhash is correct and
        // the NFT is minted on that block
        
        let seed = parseInt(blockHash) + parseInt(nftId);
        
        // all nodes will use the same seed and the random
        // number will be the same on all nodes
        let randomNumber = getRandomNumber(seed, 
          MIN, MAX
        );

        return {
          appId: APP_ID,
          nftId,
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
        let { nftId } = result;
        return soliditySha3([
          { type: 'uint32', value: APP_ID },
          { type: 'uint256', value: nftId },
          { type: 'uint256', value: result.number}
        ])

      default:
        break
    }
  }
}
