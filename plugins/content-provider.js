const BasePlugin = require('./base-plugin')
const CID = require('cids')
const PeerId = require('peer-id')
const fs = require('fs')
const chokidar = require('chokidar');
const all = require('it-all')

class ContentProvider extends BasePlugin {
  watcher = null;

  async onNewFileAdd(path){
    // console.log('Request File', path, 'has been added')
    let cidStr = new CID(path.split('.')[0]);
    await this.muon.libp2p.contentRouting.provide(cidStr)
  }

  onFileRemove(path){
    // console.log('Request File', path, 'has been removed');
  }

  async onStart() {
    /**
     * Gateway calls registration
     */
    this.muon.getPlugin('gateway-interface').on('call/request_data', this.responseToGatewayRequestData.bind(this))
    this.muon.getPlugin('remote-call').on('remote:request_data', this.responseToRemoteRequestData.bind(this))

    this.watcher = chokidar.watch('*.req', {
      // ignored: /^\./,
      ignoreInitial: false,
      persistent: true,
      depth: 2,
      cwd: `${__dirname}/../data`
    });
    this.watcher
      .on('add', this.onNewFileAdd.bind(this))
      .on('unlink', this.onFileRemove.bind(this))

  }

  async responseToGatewayRequestData(data){
    let filePath = `${__dirname}/../data/${data.cid}.req`
    if(fs.existsSync(filePath, 'utf8')){
      let content = fs.readFileSync(filePath)
      let requestData = JSON.parse(content)
      return requestData
    }
    else{
      let remoteCall = this.muon.getPlugin('remote-call');
      let cid = new CID(data.cid);
      let providers = await all(this.muon.libp2p.contentRouting.findProviders(cid, {timeout: 5000}))
      for(let provider of providers){
        if(provider.id.toB58String() !== process.env.PEER_ID){
          let peer = await this.muon.libp2p.peerRouting.findPeer(provider.id);
          let request = await remoteCall.call(peer, 'request_data', data)
          // let request = await NodeUtils.getRequestInfo(data.id)
          return request
        }
      }
      return null
    }
  }

  async responseToRemoteRequestData(data){
    let filePath = `${__dirname}/../data/${data.cid}.req`
    if(fs.existsSync(filePath, 'utf8')){
      let content = fs.readFileSync(filePath)
      return JSON.parse(content)
    }
    else{
      return null
    }
  }
}

module.exports = ContentProvider;
