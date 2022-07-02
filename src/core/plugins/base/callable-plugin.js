const BasePlugin = require('./base-plugin')

module.exports = class CallablePlugin extends BasePlugin {

  remoteCall(peer, methodName, data, options){
    let remoteCall = this.muon.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    if(Array.isArray(peer)){
      return Promise.all(peer.map(p => remoteCall.call(p, remoteMethodEndpoint, data, options)))
    }
    else{
      return remoteCall.call(peer, remoteMethodEndpoint, data, options)
    }
  }

  registerRemoteMethod(title, method){
    let remoteCall = this.muon.getPlugin('remote-call')
    if(process.env.VERBOSE){
      console.log(`Registering remote method: ${this.remoteMethodEndpoint(title)}`)
    }
    remoteCall.on(`remote:${this.remoteMethodEndpoint(title)}`, method)
  }

  remoteMethodEndpoint(title) {
    let superClass = Object.getPrototypeOf(this);
    return `${superClass.constructor.name}.${title}`
  }
}
