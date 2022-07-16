const CallablePlugin = require('./callable-plugin')

function classNames(target){
  let names = []
  let tmp = target
  while (!!tmp && !!tmp.name){
    names.push(tmp.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

module.exports.remoteMethod = function (title, options={}) {
  return function (target, property, descriptor) {
    if(!target.__remoteMethods)
      target.__remoteMethods = []
    target.__remoteMethods.push({title, property, options})
    return descriptor
  }
}

module.exports.gatewayMethod = function (title, options={}) {
  return function (target, property, descriptor) {
    if(!target.__gatewayMethods)
      target.__gatewayMethods = []
    target.__gatewayMethods.push({title, property, options})
    return descriptor
  }
}

const ipcMethodDefined = {}
module.exports.ipcMethod = function (title, options={}) {
  return function (target, property, descriptor) {
    if(ipcMethodDefined[title]) {
      const error = `IPC method [${title}] already defined.`
      console.error({error})
      throw error
    }
    ipcMethodDefined[title] = true;
    if(!target.__ipcMethods)
      target.__ipcMethods = []
    target.__ipcMethods.push({title, property, options})
    return descriptor
  }
}

module.exports.remoteApp = function (constructor) {
  if(!classNames(constructor).includes('CallablePlugin'))
    throw {message: 'RemoteApp should be CallablePlugin.'}
  let extended = class extends constructor {
    async onStart(){
      await super.onStart();

      if(constructor.prototype.__remoteMethods) {
        for (let i = 0; i < constructor.prototype.__remoteMethods.length; i++) {
          let item = constructor.prototype.__remoteMethods[i];
          // console.log('########## registering remote method', item, this.remoteMethodEndpoint(item.title))
          this.registerRemoteMethod(item.title, this[item.property].bind(this))
        }
      }

      if(constructor.prototype.__ipcMethods) {
        for (let i = 0; i < constructor.prototype.__ipcMethods.length; i++) {
          let item = constructor.prototype.__ipcMethods[i];
          // console.log('########## registering ipc method', item, this.remoteMethodEndpoint(item.title))
          this.registerIpcMethod(item.title, this[item.property].bind(this))
        }
      }

      if(constructor.prototype.__gatewayMethods) {
        let gateway = this.muon.getPlugin('gateway-interface')
        for (let i = 0; i < constructor.prototype.__gatewayMethods.length; i++) {
          let item = constructor.prototype.__gatewayMethods[i];
          // let logTitle = `${this.APP_NAME}.${item.title}`
          // console.log(`registering gateway method: ${logTitle} >> ${target.name}.${item.property}`)
          gateway.registerAppCall(this.APP_NAME, item.title, this[item.property].bind(this))
        }
      }
    }
  };

  Object.defineProperty(extended, 'name', {value: constructor.name, writable: false})
  return extended;
}
