const { axios, toBaseUnit, soliditySha3, ethCall, ethRead, timeout } = MuonAppUtils
const tssUtils = require('../../utils/tss')

module.exports = {
  APP_NAME: 'tss',
  useTss: true,

  // TODO: move this method into the base-tss-app-plugin
  onArrive: async function(request){
    let {method, data: {params}} = request;
    switch (method) {
      case 'test':
        let tssPlugin = this.muon.getPlugin(`__tss-plugin__`)
        let party = await tssPlugin.makeParty(8)
        // console.log('party generation done.', party)
        if(!party)
          throw {message: 'party not generated'}

        let nonce = await tssPlugin.keyGen(party)

        // let sign = tssPlugin.sign(null, party);
        return {party: party.id, nonce: nonce.id}
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

  hashRequestResult: function (request, result){
    // let {data: {init: {party, nonce}}} = request;
    // let tssPlugin = this.muon.getPlugin('__tss-plugin__')
    switch (request.method) {
      case 'test':
        // let _party = tssPlugin.getParty(party)
        // let _nonce = tssPlugin.getSharedKey(nonce)
        // let hash = tssPlugin.hash(result, _party, _nonce);
        // console.log({hash})
        return 'done'
      default:
        throw { message: `Unknown method: ${request.method}` }
    }
  },
}
