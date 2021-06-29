const BaseAppPlugin = require('./base-app-plugin')
const NodeUtils = require('../../utils/node-utils')
const all = require('it-all')

class BaseServicePlugin extends BaseAppPlugin {
  serviceId=null
  serviceProviders = []

  constructor(...args) {
    super(...args);

    /**
     * This is abstract class, so "new BaseServicePlugin()" is not allowed
     */
    if (new.target === BaseServicePlugin) {
      throw new TypeError("Cannot construct abstract BaseServicePlugin instances directly");
    }
  }

  async onStart(){
    super.onStart();
    this.initializeService()
  }

  async initializeService(){
    let serviceCID = await NodeUtils.common.strToCID(this.getBroadcastChannel())
    await this.muon.libp2p.contentRouting.provide(serviceCID)
    this.serviceId = serviceCID
    // console.log({app: this.APP_NAME, serviceCID: serviceCID.toString()})

    let remoteCall = this.muon.getPlugin('remote-call')
    remoteCall.on(`remote:app-${this.APP_NAME}-wantSign`, this.__onRemoteWantSign.bind(this))

    setTimeout(this.updatePeerList.bind(this), 9000);
  }

  // TODO [sta]: sort providers ba latency (small latency first).
  async updatePeerList(){
    try {
      // console.log(`App[${this.APP_NAME}] updating peer list ...`)
      let providers = await all(this.muon.libp2p.contentRouting.findProviders(this.serviceId, {timeout: 5000}))
      let otherProviders = providers.filter(({id}) => (id._idB58String !== process.env.PEER_ID))

      // console.log(`providers :`,otherProviders)
      for (let provider of otherProviders) {

        let strPeerId = provider.id.toB58String();
        if (strPeerId === process.env.PEER_ID)
          continue;

        // console.log('pinging ', strPeerId)
        const latency = await this.muon.libp2p.ping(provider.id)
        // console.log({latency})
      }
      this.serviceProviders = otherProviders;
    }
    catch (e) {}

    setTimeout(this.updatePeerList.bind(this), 30000)
  }

  broadcastNewRequest(request){
    this.serviceProviders.map(async provider => {
      this.remoteCall(provider, 'wantSign', request)
        .then(this.__onRemoteSignRequest.bind(this))
    })
  }

  async __onRemoteWantSign(request){
    let sign = await this.processRemoteRequest(request)
    // console.log('wantSign', request._id, sign)
    return sign;
  }
}

module.exports = BaseServicePlugin
