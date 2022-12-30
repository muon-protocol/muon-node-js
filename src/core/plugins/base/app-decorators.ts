import {GlobalBroadcastChannel, RemoteMethodOptions} from '../../../common/types'
import CoreBroadcastPlugin from "../../../core/plugins/broadcast.js";

function classNames(target): string[] {
  let names: string[] = []
  let tmp = target
  while (!!tmp && !!tmp.name){
    names.push(tmp.name)
    tmp = Object.getPrototypeOf(tmp);
  }
  return names;
}

export function remoteMethod (title, options: RemoteMethodOptions={}) {
  return function (target, property, descriptor) {
    if(!target.__remoteMethods)
      target.__remoteMethods = []
    target.__remoteMethods.push({title, property, options})
    return descriptor
  }
}

export function gatewayMethod (title, options={}) {
  return function (target, property, descriptor) {
    if(!target.__gatewayMethods)
      target.__gatewayMethods = []
    target.__gatewayMethods.push({title, property, options})
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

export function globalBroadcastHandler (title: GlobalBroadcastChannel, options={}) {
  return function (target, property, descriptor) {
    if(!target.__globalBroadcastHandlers)
      target.__globalBroadcastHandlers = []
    target.__globalBroadcastHandlers.push({title, property, options})
    return descriptor
  }
}

/**
 * Exported methods can be call by apps.
 *
 * public: any app (built-in & client) can call this method
 * built-in: only built-in app can call this method. Client apps are not permitted to call these methods.
 *
 * Example
 * ======= app.js ========
 * ...
 * this.callPlugin(<plugin-name>, <method>, <arguments>)
 * ...
 */
export type ApiExportType = "public" | "built-in"

export type ApiExportOptions = {
  type?: ApiExportType
}

export function appApiMethod (options: ApiExportOptions={}) {
  return function (target, property, descriptor) {
    if(!target.__appApiExports)
      target.__appApiExports = {}
    target.__appApiExports[property] = {property, options}
    return descriptor
  }
}

export function remoteApp (constructor): any {
  if(!classNames(constructor).includes('CallablePlugin')) {
    const error = {message: 'RemoteApp should be CallablePlugin.'}
    console.error(error)
    throw error;
  }
  let extended = class extends constructor {
    async onStart(){
      await super.onStart();

      if(constructor.prototype.__remoteMethods) {
        for (let i = 0; i < constructor.prototype.__remoteMethods.length; i++) {
          let item = constructor.prototype.__remoteMethods[i];
          // console.log('########## registering remote method', item, this.remoteMethodEndpoint(item.title))
          this.registerRemoteMethod(item.title, this[item.property].bind(this), {
            /** default options */
            allowShieldNode: false,
            /** override options */
            ...item.options,
            /** other props */
            method: item.title,
            appName: this.APP_NAME,
            appId: this.APP_ID,
          })
        }
      }

      if(constructor.prototype.__globalBroadcastHandlers) {
        const broadcastPlugin: CoreBroadcastPlugin = this.muon.getPlugin('broadcast')
        for (let i = 0; i < constructor.prototype.__globalBroadcastHandlers.length; i++) {
          let item = constructor.prototype.__globalBroadcastHandlers[i];
          await broadcastPlugin.subscribe(item.title)
          // @ts-ignore
          broadcastPlugin.on(item.title, this[item.property].bind(this))
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
