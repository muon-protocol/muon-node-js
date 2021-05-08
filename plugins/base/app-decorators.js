module.exports.remoteMethod = function (title) {
  return function (target, property, descriptor) {
    if(!target.__remoteMethods)
      target.__remoteMethods = []
    target.__remoteMethods.push({title, property})
    return descriptor
  }
}

module.exports.gatewayMethod = function (title) {
  return function (target, property, descriptor) {
    if(!target.__gatewayMethods)
      target.__gatewayMethods = []
    target.__gatewayMethods.push({title, property})
    return descriptor
  }
}

module.exports.remoteApp = function (target) {
  const original = target;

  function construct(constructor, args) {
    const c = function () {
      return constructor.apply(this, args);
    }

    const oldOnStart = constructor.prototype.onStart;

    c.prototype = constructor.prototype;
    if(constructor.prototype.__remoteMethods || constructor.prototype.__gatewayMethods) {
      c.prototype.onStart = async function () {
        await oldOnStart.apply(this)

        if(constructor.prototype.__remoteMethods) {
          let remoteCall = this.muon.getPlugin('remote-call')
          for (let i = 0; i < constructor.prototype.__remoteMethods.length; i++) {
            let item = constructor.prototype.__remoteMethods[i];
            let logTitle = `remote:${this.APP_NAME}-${item.title}`
            console.log(`registering remote method: ${logTitle} >> ${target.name}.${item.property}`)
            remoteCall.on(`remote:app-${this.APP_NAME}-${item.title}`, this[item.property].bind(this))
          }
        }

        if(constructor.prototype.__gatewayMethods) {
          let gateway = this.muon.getPlugin('gateway-interface')
          for (let i = 0; i < constructor.prototype.__gatewayMethods.length; i++) {
            let item = constructor.prototype.__gatewayMethods[i];
            let logTitle = `${this.APP_NAME}.${item.title}`
            console.log(`registering gateway method: ${logTitle} >> ${target.name}.${item.property}`)
            gateway.registerAppCall(this.APP_NAME, item.title, this[item.property].bind(this))
          }
        }
      }
    }
    return new c();
  }

  const f = function (...args) {
    return construct(original, args);
  }

  f.prototype = original.prototype;

  return f;
}
