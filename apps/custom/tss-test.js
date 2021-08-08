const { axios, toBaseUnit, soliditySha3, ethCall, ethRead, timeout } = MuonAppUtils

module.exports = {
  APP_NAME: 'tss',

  onArrive: async function(request){
    let {method, data: {params}} = request;
    switch (method) {
      case 'test':
        let tss = this.muon.getPlugin(`__tss-plugin__`)
        let party = await tss.makeParty()
        // console.log('party generation done.', party)
        if(!party)
          throw {message: 'party not generated'}

        let sign = tss.sign(null, party);
        break
    }
  },

  onRequest: async function (request) {
    let {method, data: {params}} = request;
    switch (method) {
      case 'test':
        return 'done'
      default:
        throw {message: `invalid method ${method}`}
    }
  },

  hashRequestResult: (request, result) => {
    switch (request.method) {
      case 'test':
        return 'done'
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  },
}
