const { axios, soliditySha3, floatToBN } = MuonAppUtils

const APP_ID = 13

function getRandomNumber(min, max){
  return Math.random() * (max - min) + min;
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

        let randomNumber = getRandomNumber();

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
    let { method } = request
    var number = result.number;
    if(request.data.result && request.data.result.number){
      number = request.data.result.number;
    }
    switch (method) {
      case 'randint':
        let { address } = result;
        return soliditySha3([
          { type: 'uint32', value: APP_ID },
          { type: 'address', value: address },
          { type: 'uint256', value: number}
        ])

      default:
        break
    }
  }
}
