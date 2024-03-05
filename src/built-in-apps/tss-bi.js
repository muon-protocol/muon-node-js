const {soliditySha3} = MuonAppUtils
const TssApp = {
  APP_NAME: 'tss-bi',
  useFrost: true,

  onArrive: async function(request) {
    let {method, data: {params}} = request;
    switch(method) {
      case "lock": {
        let {user, task} = params;
        let lock = await this.readGlobalMem(`user-lock-${user}`)
        if (lock) {
          throw {message: `User [${user}] locked for a moment`}
        }
        await this.writeGlobalMem(`user-lock-${user}`, task, 10);
      }
    }
  },

  onRequest: async function (request) {
    let {method, data: {params={}}, reqId} = request;
    switch (method) {
      case 'test':
        return params.message || 'done';
      case "lock": {
        let {user, task:expected} = params
        const memValue = await this.readGlobalMem(`user-lock-${user}`)
        if(memValue !== expected)
          throw { 
            message: `error when checking lock`,
            memValue, 
            expected,
          }
        return 'lock done.'
      }
      case 'data-change':
        return Math.random()
      default:
        throw {message: `Unknown method: ${method}`}
    }
  },

  signParams: function (request, result) {
    switch (request.method) {
      case 'test':
      case 'lock':
      case 'data-change':
        return [{type: 'string', value: result.toString()}]
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  }
}

module.exports = TssApp
