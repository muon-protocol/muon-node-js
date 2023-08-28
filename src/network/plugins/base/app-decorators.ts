import {NetworkRemoteCallMiddleware} from "../../remotecall-middleware";

function classNames(target): string[]{
  let names: string[] = []
  let tmp = target
  while (!!tmp && !!tmp.name){
    names.push(tmp.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

export function remoteMethod (title, ...middlewares: NetworkRemoteCallMiddleware[]) {
  return function (target, property, descriptor) {
    if(!target.__remoteMethods)
      target.__remoteMethods = []
    target.__remoteMethods.push({title, property, middlewares})
    return descriptor
  }
}

const ipcMethodDefined = {}
export function ipcMethod (title, options={}) {
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

export function broadcastHandler (target, property, descriptor) {
  if(target.__broadcastHandlerMethod !== undefined){
    const error = `Broadcast handler method already defined.`
    console.error({error})
    throw error
  }
  target.__broadcastHandlerMethod = property
  return descriptor
}

export function remoteApp (constructor): any {
  if(!classNames(constructor).includes('CallablePlugin'))
    throw {message: 'RemoteApp should be CallablePlugin.'}
  let extended = class extends constructor {
    async onStart(){
      await super.onStart();

      if(constructor.prototype.__remoteMethods) {
        for (let i = 0; i < constructor.prototype.__remoteMethods.length; i++) {
          let item = constructor.prototype.__remoteMethods[i];
          // console.log('########## registering remote method', item, this.remoteMethodEndpoint(item.title))
          this.registerRemoteMethod(item.title, this[item.property].bind(this), {
            /** override options */
            middlewares: item.middlewares,
            /** other props */
            method: item.title,
            appName: this.APP_NAME,
            appId: this.APP_ID,
          })
        }
      }

      if(constructor.prototype.__ipcMethods) {
        for (let i = 0; i < constructor.prototype.__ipcMethods.length; i++) {
          let item = constructor.prototype.__ipcMethods[i];
          // console.log('########## registering ipc method', item, this.remoteMethodEndpoint(item.title))
          this.registerIpcMethod(item.title, this[item.property].bind(this))
        }
      }
    }
  };

  Object.defineProperty(extended, 'name', {value: constructor.name, writable: false})
  return extended;
}
