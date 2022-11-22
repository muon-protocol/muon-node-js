import BaseNetworkPlugin from './base-network-plugin';
const log = require('debug')('muon:network:plugins:callable')

export default class CallablePlugin extends BaseNetworkPlugin {

  remoteCall(peer, methodName, data, options?){
    let remoteCall = this.network.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    if(Array.isArray(peer)){
      return Promise.all(peer.map(p => remoteCall.call(p, remoteMethodEndpoint, data, options)))
    }
    else{
      return remoteCall.call(peer, remoteMethodEndpoint, data, options)
    }
  }

  registerRemoteMethod(title, method, options){
    let remoteCall = this.network.getPlugin('remote-call')
    log(`Registering remote method: ${this.remoteMethodEndpoint(title)}`)
    remoteCall.on(`${this.remoteMethodEndpoint(title)}`, method, options)
  }

  registerIpcMethod(title, method){
    let ipc = this.network.getPlugin('ipc')
    log(`Registering ipc method: ${this.remoteMethodEndpoint(title)}`)
    ipc.on(`call/${title}`, method)
  }

  remoteMethodEndpoint(title) {
    let superClass = Object.getPrototypeOf(this);
    return `${superClass.constructor.name}.${title}`
  }
}
