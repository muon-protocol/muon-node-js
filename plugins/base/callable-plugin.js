const BasePlugin = require('./base-plugin')
const BaseAppPlugin = require('./base-app-plugin')

function classNames(target){
  let names = []
  let tmp = target
  while (!!tmp && (tmp.name || tmp.constructor.name)){
    names.push(tmp.name || tmp.constructor.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

/**
 * Moved to base-plugin
 * This plugin will remove soon.
 *
 * @type {module.CallablePlugin}
 */
module.exports = class CallablePlugin extends BasePlugin {

  async onStart(){
    super.onStart();
    // let {__remoteMethods, __gatewayMethods} = this;
    //
    // if(__remoteMethods) {
    //   __remoteMethods.forEach(item => {
    //     this.registerRemoteMethod(item.title, this[item.property].bind(this))
    //   })
    // }
    // if(__gatewayMethods) {
    //   let gateway = this.muon.getPlugin('gateway-interface')
    //
    //   let isApp = classNames(Object.getPrototypeOf(this)).includes('BaseAppPlugin')
    //
    //   __gatewayMethods.forEach(item =>{
    //     console.log('========', item)
    //     if(isApp)
    //       gateway.registerAppCall(this.APP_NAME, item.title, this[item.property].bind(this))
    //     else
    //       gateway.registerMuonCall(item.title, this[item.property].bind(this))
    //   })
    // }
  }

  // remoteCall(peer, methodName, data){
  //   let remoteCall = this.muon.getPlugin('remote-call')
  //   let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
  //   if(Array.isArray(peer)){
  //     return Promise.all(peer.map(p => remoteCall.call(p, remoteMethodEndpoint, data)))
  //   }
  //   else{
  //     return remoteCall.call(peer, remoteMethodEndpoint, data)
  //   }
  // }
  //
  // registerRemoteMethod(title, method){
  //   let remoteCall = this.muon.getPlugin('remote-call')
  //   if(process.env.VERBOSE){
  //     console.log(`Registering remote method: ${this.remoteMethodEndpoint(title)}`)
  //   }
  //   remoteCall.on(this.remoteMethodEndpoint(title), method)
  // }
  //
  // remoteMethodEndpoint(title) {
  //   let superClass = Object.getPrototypeOf(this);
  //   return `${superClass.constructor.name}.${title}`
  // }
}
