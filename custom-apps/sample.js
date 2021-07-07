const { soliditySha3 } = MuonAppUtils

module.exports = {
  APP_NAME: 'sample',

  onRequest: async function (method, params) {
    switch (method) {
      case 'test':
        return 1 + Math.random()
      case 'currentDate':
        return new Date().toDateString()
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

      default:
        return null
    }
  }
}
