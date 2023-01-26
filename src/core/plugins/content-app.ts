import CallablePlugin from './base/callable-plugin.js'
import Content, {create as createContent} from '../../common/db-models/Content.js'
import {remoteApp, remoteMethod, gatewayMethod} from './base/app-decorators.js'
import {GatewayCallData} from "../../gateway/types";
import * as NetworkIpc from '../../network/ipc.js';
import ContentVerifyPlugin from "./content-verify-plugin.js";

@remoteApp
class ContentApp extends CallablePlugin {
  APP_NAME = 'content'

  async onGatewayConfirmed(response){
    return; //REZA: TODO: fix this
    console.log("onGatewayConfirmed");
    let content = await createContent(response)
    await content.save();
    response['cid'] = content.cid;
    await NetworkIpc.provideContent([content.cid])
  }

  async onStart() {
    super.onStart()

    this.muon.getPlugin('gateway-interface').on('confirmed', this.onGatewayConfirmed.bind(this))
  }

  async getContent(cid: string): Promise<string | null>{
    let content = await Content.findOne({cid});
    if(content){
      // console.log(`content found locally`, content.content)
      return content.content;
    }else{
      let providers = await NetworkIpc.findContent(cid);
      for(let provider of providers){
        if(provider !== process.env.PEER_ID){
          let request = await this.remoteCall(provider, 'get_content', {cid})
          if(request) {
            // console.log(`content found on peer ${provider}`, request)
            return request;
          }
        }
      }
      return null
    }
  }

  prepareOutput(content: string, format){
    return format.toLowerCase() === 'json' ? JSON.parse(content) : content;
  }

  @gatewayMethod('verify')
  async verifyContent(data){
    let cid = data.params.cid;

    let content: string | null = await this.getContent(cid)
    let verifyPlugin: ContentVerifyPlugin = this.muon.getPlugin('content-verify');
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

  @gatewayMethod('get_content')
  async responseToGatewayRequestData(data: GatewayCallData){
    let {cid, format='string'} = data.params;
    let content = await this.getContent(cid)
    if(content){
      return this.prepareOutput(content, format);
    }else{
      return null
    }
  }

  @remoteMethod('get_content')
  async responseToRemoteRequestData(data): Promise<string | null>{
    let content = await Content.findOne({cid: data.cid});
    if(content)
      return content.content
    else
      return null;
  }
}

export default ContentApp;
