module.exports = {
  APP_NAME: 'fear_presale',
  APP_ID: 6,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'deposit':
        break

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'deposit':
        break

      default:
        return null
    }
  }
}
