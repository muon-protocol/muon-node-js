
function classNames(target){
  let names = []
  let tmp = target
  while (!!tmp && (tmp.name || tmp.constructor.name)){
    names.push(tmp.name || tmp.constructor.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

function isCallable(target) {
  return classNames(target).includes('CallablePlugin')
}

function isApp(target) {
  return classNames(target).includes('BaseAppPlugin')
}

function validateTarget(target) {
  if(!isCallable(target)) {
    throw {message: `@remoteMethod and @gatewayMethod decorators, can only be used at CallablePlugin.`}
  }
}

module.exports.remoteMethod = function (title, options={}) {
  return function (target, property, descriptor) {
    validateTarget(target);
    if(property === 'function'){
      throw {message: `Error at [${target.constructor.name}]: Anonymous function not allowed as remote method. Define this method with a name.`}
    }
    if(!target.__remoteMethods)
      target.__remoteMethods = []
    let titleIndex = target.__remoteMethods.findIndex(m => (m.title === title))
    if(titleIndex >= 0)
      throw {message: `ERROR at [${target.constructor.name}]: Remote method with title "${title}" already defined`}
    // if(__allGatewayMethods[title])
    let propIndex = target.__remoteMethods.findIndex(m => (m.property === property))
    if(propIndex >= 0)
      throw {message: `ERROR at [${target.constructor.name}]: Remote method with property "${property}" already defined`}
    target.__remoteMethods.push({title, property, options})
    return descriptor
  }
}

const __globalGatewayMethods = {};

module.exports.gatewayMethod = function (title) {
  return function (target, property, descriptor) {
    validateTarget(target);
    if(property === 'function'){
      throw {message: `Error at [${target.constructor.name}]: Anonymous function not allowed as gateway method. Define this method with a name.`}
    }
    if(!target.__gatewayMethods)
      target.__gatewayMethods = []
    let titleIndex = target.__gatewayMethods.findIndex(m => (m.title === title))
    if(titleIndex >= 0)
      throw {message: `ERROR at [${target.constructor.name}]: Gateway method with title "${title}" already defined`}
    // if(__allGatewayMethods[title])
    let propIndex = target.__gatewayMethods.findIndex(m => (m.property === property))
    if(propIndex >= 0)
      throw {message: `ERROR at [${target.constructor.name}]: Gateway method with property "${property}" already defined`}

    // TODO: only one handler should be defined for muon call.
    if(!isApp(target)) {
      if(__globalGatewayMethods[title])
        throw {message: `Multiple definition of global @gatewayMethod("${title}").`}
      __globalGatewayMethods[title] = true;
    }
    target.__gatewayMethods.push({title, property})
    return descriptor
  }
}
