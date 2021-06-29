
function dynamicExtend(superclass, proto) {
  let Extended = function (...args) {
    Object.assign(this, new superclass(...args));

    for(let key in proto){
      if(proto.hasOwnProperty(key)){
        this[key] = proto[key]
        this.constructor.prototype[key] = proto[key]
      }
    }
  }
  Object.setPrototypeOf(Extended, superclass);
  Object.setPrototypeOf(Extended.prototype, superclass.prototype);
  Object.defineProperty(Extended, 'name', {value: `Extended${superclass.name}`, writable: false})
  return Extended;
}

module.exports = {
  dynamicExtend,
}
