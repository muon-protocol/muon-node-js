module.exports = {
  APP_NAME: 'sample',

  onRequest: async function (method, params) {
    switch (method) {
      case "test":
        return 1 + Math.random()
      default:
        return "test done"
    }
  },

  hashRequestResult: (request, result) => {
    return Math.floor(result).toString();
  }
}
