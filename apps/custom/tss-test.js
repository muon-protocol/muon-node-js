const {soliditySha3} = MuonAppUtils
const TssApp = {
  APP_NAME: 'tss',
  useTss: true,

  onRequest: async function (request) {
    let {method, data: {params}} = request;
    switch (method) {
      case 'test':
        return 'done'
      default:
        throw {message: `invalid method ${method}`}
    }
  },

  hashRequestResult: function (request, result){
    switch (request.method) {
      case 'test':
        return soliditySha3([{type: 'string', value: result}]);
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  },
}

module.exports = TssApp
