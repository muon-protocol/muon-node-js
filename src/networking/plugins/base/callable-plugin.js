const BaseNetworkPlugin = require('./base-network-plugin')

module.exports = class CallablePlugin extends BaseNetworkPlugin {

  remoteCall(peer, methodName, data, options){
    let remoteCall = this.network.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    if(Array.isArray(peer)){
      return Promise.all(peer.map(p => remoteCall.call(p, remoteMethodEndpoint, data, options)))
    }
    else{
      return remoteCall.call(peer, remoteMethodEndpoint, data, options)
    }
  }

  registerRemoteMethod(title, method){
    let remoteCall = this.network.getPlugin('remote-call')
    if(process.env.VERBOSE){
      console.log(`Registering remote method: ${this.remoteMethodEndpoint(title)}`)
    }
    remoteCall.on(`${this.remoteMethodEndpoint(title)}`, method)
  }

  registerIpcMethod(title, method){
    let ipc = this.network.getPlugin('ipc')
    if(process.env.VERBOSE){
      console.log(`Registering ipc method: ${this.remoteMethodEndpoint(title)}`)
    }
    ipc.on(`call/${title}`, method)
  }

  remoteMethodEndpoint(title) {
    let superClass = Object.getPrototypeOf(this);
    return `${superClass.constructor.name}.${title}`
  }
}
