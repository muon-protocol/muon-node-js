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
  Object.defineProperty(Extended, 'name', {value: `DynamicExtended(${proto.APP_NAME}@${superclass.name})`, writable: false})
  return Extended;
}

export {
  dynamicExtend,
}
