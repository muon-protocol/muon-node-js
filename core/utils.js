const util = require('util')
const ProxyExtend = require('proxy-extend')

function dynamicExtend(superclass, proto) {
  let Extended = function (...args) {
    Object.assign(this, new superclass(...args));

    for(let key in proto){
      if(proto.hasOwnProperty(key)){
        if(key.startsWith('_') && superclass.prototype.hasOwnProperty(key)) {
          throw {message: `User app property [${key}] override failed. Any property that starts with "_" cannot be override`}
        }
        this[key] = proto[key]
        this.constructor.prototype[key] = proto[key]
      }
    }
  }
  Object.setPrototypeOf(Extended, superclass)
  Object.setPrototypeOf(Extended.prototype, superclass.prototype);
  // Object.defineProperty(Extended, 'name', {value: `Extended${superclass.name}`, writable: false})

  Object.defineProperty(Extended, 'name', {value: `DynamicExtended(${proto.APP_NAME}@${superclass.name})`, writable: false})
  return Extended;
}

// function dynamicExtend(superclass, proto){
//   Object.setPrototypeOf(proto, superclass);
//   Object.setPrototypeOf(proto.prototype, superclass.prototype);
// }
function dynamicExtend2(superclass, proto) {
  function construct(constructor, args){
    const c = function () {
      return constructor.apply(this, args);
    }
    Object.setPrototypeOf(c, constructor)
    Object.setPrototypeOf(c.prototype, constructor.prototype)
    // c.prototype = constructor.prototype;
    for(let key in proto){
      if(proto.hasOwnProperty(key)){
        if(key.startsWith('_') && superclass.prototype.hasOwnProperty(key)) {
          throw {message: `User app property [${key}] override failed. Any property that starts with "_" cannot be override`}
        }
        // this[key] = proto[key]
        c.prototype[key] = proto[key]
      }
    }
    return new c();
  }

  function Extended(...args) {
    return construct(superclass, args)
    // return baseclass.apply(this, args);
  }
  // Object.setPrototypeOf(Extended, superclass);
  // Extended.prototype = superclass.prototype;
  // Object.setPrototypeOf(Extended.prototype, superclass.prototype);
  return Extended;
}

function dynamicExtend3(sup, base) {
  function construct(constructor, proto, args) {
    const c = function () {
      return constructor.apply(this, args);
    }
    c.prototype = constructor.prototype;
    return new Proxy(new c(), {
      get: function (target, prop, receiver) {
        if(proto.hasOwnProperty(prop))
          return proto[prop]
        return Reflect.get(...arguments);
      }
    });
  }
  const f = function (...args) {
    return construct(sup, base, args);
  }
  return f;
}

module.exports = {
  dynamicExtend,
  dynamicExtend2,
  dynamicExtend3,
}
