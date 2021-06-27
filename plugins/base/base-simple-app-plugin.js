const BasePlugin = require('./base-plugin')

class BaseSimpleAppPlugin extends BasePlugin {
  APP_NAME = null;

  constructor(...args) {
    super(...args);

    /**
     * This is abstract class, so "new BaseSimpleAppPlugin()" is not allowed
     */
    if (new.target === BaseSimpleAppPlugin) {
      throw new TypeError("Cannot construct abstract BaseSimpleAppPlugin instances directly");
    }
  }

  remoteMethodEndpoint(title){
    return `app-${this.APP_NAME}-${title}`
  }

  remoteCall(peer, methodName, data){
    let remoteCall = this.muon.getPlugin('remote-call');
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    return remoteCall.call(peer, remoteMethodEndpoint, data)
  }
}

module.exports = BaseSimpleAppPlugin
