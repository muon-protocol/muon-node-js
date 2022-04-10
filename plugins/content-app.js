const BaseApp = require('./base/base-app-plugin')
const Content = require('../gateway/models/Content')
const CID = require('cids')
const all = require('it-all')
const {remoteApp, remoteMethod, gatewayMethod} = require('./base/app-decorators')

@remoteApp
class ContentApp extends BaseApp {
  APP_NAME = 'content'

  async onGatewayConfirmed(response){
    let content = await Content.create(response)
    await content.save();
    response['cid'] = content.cid;
  }

  async onStart() {
    this.muon.getPlugin('gateway-interface').on('confirmed', this.onGatewayConfirmed.bind(this))

    let contents = await Content.find({});
    for(let i in contents) {
      let {cid} = contents[i]
      await this.muon.libp2p.contentRouting.provide(new CID(cid))
    }
  }

  async getContent(cid){
    return this.responseToGatewayRequestData({cid})
  }

  @gatewayMethod('verify')
  async verifyContent(data){
    let {cid} = data;
    let content = await this.muon.getPlugin('content').getContent(cid)
    let verifyPlugin = this.muon.getPlugin('content-verify');
    if(content){
      let [verified, description, expectedResult, actualResult] = await verifyPlugin.verifyContent(content, cid)
      return {
        verified,
        description,
        expectedResult,
        actualResult,
        data
      }
    }
    else{
      return {
        verified: false,
        description: 'no content',
        data,
      }
    }
  }

  prepareOutput(content, format){
    return format.toLowerCase() === 'json' ? JSON.parse(content) : content;
  }

  @gatewayMethod('get_content')
  async responseToGatewayRequestData(data={}){
    let {cid, format='string'} = data;
    let content = await Content.findOne({cid});
    if(content){
      return this.prepareOutput(content.content, format);
    }else{
      let cid = new CID(data.cid);
      let providers = await all(this.muon.libp2p.contentRouting.findProviders(cid, {timeout: 5000}))
      for(let provider of providers){
        if(provider.id.toB58String() !== process.env.PEER_ID){
          let peer = await this.findPeer(provider.id);
          let request = await this.remoteCall(peer, 'get_content', data)
          return this.prepareOutput(request, format)
        }
      }
      return null
    }
  }

  @remoteMethod('get_content')
  async responseToRemoteRequestData(data){
    let content = await Content.findOne({cid: data.cid});
    if(content)
      return content.content
    else
      return null;
  }
}

module.exports = ContentApp;
