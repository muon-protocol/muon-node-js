import CallablePlugin from './base/callable-plugin'
const Content = require('../../gateway/models/Content')
const all = require('it-all')
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators'
const {loadCID} = require('../../utils/cid')
const {timeout} = require('../../utils/helpers')

@remoteApp
class ContentApp extends CallablePlugin {
  APP_NAME = 'content'

  async onGatewayConfirmed(response){
    let content = await Content.create(response)
    await content.save();
    response['cid'] = content.cid;
  }

  async onStart() {
    super.onStart()

    this.muon.getPlugin('gateway-interface').on('confirmed', this.onGatewayConfirmed.bind(this))

    // this.muon.once('peer:connect', () => {
    //   this.provideContents();
    // })
  }

  // TODO: move to networking
  async provideContents() {
    /** wait to DHT load peer info */
    await timeout(50000);

    try {
      let contents = await Content.find({});
      for (let i in contents) {
        let {cid} = contents[i]
        await this.muon.libp2p.contentRouting.provide(loadCID(cid));
      }
    }catch (e) {
      console.error("ERROR: ContentApp.provideContents", e)
    }
  }

  async getContent(cid){
    return this.responseToGatewayRequestData({cid})
  }

  @gatewayMethod('verify')
  async verifyContent(data){
    let cid = data.params.cid;

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
    // @ts-ignore
    let {cid, format='string'} = data.params;
    let content = await Content.findOne({cid});
    if(content){
      return this.prepareOutput(content.content, format);
    }else{
      // @ts-ignore
      let cid = loadCID(data.cid);
      let providers = await all(this.muon.libp2p.contentRouting.findProviders(cid, {timeout: 5000}))
      for(let provider of providers){
        if(provider.id.toB58String() !== process.env.PEER_ID){
          let peer = await this.findPeer(provider.id);
          // @ts-ignore
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

export default ContentApp;
