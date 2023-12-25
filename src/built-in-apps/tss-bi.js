const {soliditySha3} = MuonAppUtils
const TssApp = {
  APP_NAME: 'tss-bi',
  useFrost: true,

  onRequest: async function (request) {
    let {method, data: {params={}}} = request;
    switch (method) {
      case 'test':
        return params.message || 'done';
      case 'data-change':
        return Math.random()
      default:
        throw {message: `invalid method ${method}`}
    }
  },

  signParams: function (request, result) {
    switch (request.method) {
      case 'test':
      case 'data-change':
        return [{type: 'string', value: result.toString()}]
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  }
}

module.exports = TssApp
