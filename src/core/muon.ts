'use strict'
/* eslint-disable no-console */
import {CoreGlobalEvent} from "./ipc.js";
import Events from 'events'
import chalk from 'chalk'
import fs from 'fs'
import { MessagePublisher, MessageSubscriber } from '../common/message-bus/index.js'
import { GLOBAL_EVENT_CHANNEL, fireEvent } from './ipc.js'
import * as NetworkIpc from '../network/ipc.js'
import MuonBasePlugin from './plugins/base/base-plugin.js';
import BaseAppPlugin from "./plugins/base/base-app-plugin.js";
import BasePlugin from "./plugins/base/base-plugin.js";
import {Constructor, NetConfigs} from "../common/types";

export type MuonPluginConfigs = any

export type MuonPlugin = {
  name: string ,
  module: Constructor<BasePlugin>,
  config: MuonPluginConfigs
}

export type MuonConfigs = {
  plugins: MuonPlugin[],
  net: NetConfigs,
}

export default class Muon extends Events {
  configs: MuonConfigs
  _plugins = {}
  private _apps = {}
  private appIdToNameMap = {}
  private appNameToIdMap = {}
  globalEventBus = new MessageSubscriber(GLOBAL_EVENT_CHANNEL)

  constructor(configs: MuonConfigs) {
    super()
    this.configs = configs
  }

  async initialize() {
    await this._initializePlugin(this.configs.plugins)
  }

  async _initializePlugin(plugins: MuonPlugin[]) {
    for (let plugin of plugins) {
      try {
        const pluginInstance = new plugin.module(this, plugin.config)
        this._plugins[plugin.name] = pluginInstance
        await pluginInstance.onInit();

        if (pluginInstance instanceof BaseAppPlugin) {
          if (pluginInstance.APP_NAME) {
            if (this.appNameToIdMap[pluginInstance.APP_NAME])
              throw `There is two app with same APP_NAME: ${pluginInstance.APP_NAME}`
            this._apps[pluginInstance.APP_ID] = pluginInstance;
            this.appIdToNameMap[pluginInstance.APP_ID] = pluginInstance.APP_NAME
            this.appNameToIdMap[pluginInstance.APP_NAME] = pluginInstance.APP_ID
          }
        }
      }
      catch (e) {
        console.error(`error on initializing plugin [${plugin.name}]`, e);
      }
    }
    // console.log('plugins initialized.')
  }

  getAppNameById(appId): string {
    return this.appIdToNameMap[appId]
  }

  getAppIdByName(appName): string {
    return this.appNameToIdMap[appName] || "0";
  }

  getAppByName(appName) {
    const appId = this.getAppIdByName(appName)
    return this.getAppById(appId);
  }

  getAppById(appId) {
    return this._apps[appId] || null;
  }

  getPlugin(pluginName) {
    return this._plugins[pluginName]
  }

  // getAppByName(appName) {
  //   if (!appName) return null
  //   let keys = Object.keys(this._plugins)
  //   for (let i = 0; i < keys.length; i++) {
  //     if (this._plugins[keys[i]].APP_NAME === appName)
  //       return this._plugins[keys[i]]
  //   }
  //   return null
  // }

  async start() {
    // @ts-ignore
    this.globalEventBus.on("message", this.onGlobalEventReceived.bind(this));
    await this._onceStarted();
  }

  async _onceStarted() {
    for (let pluginName in this._plugins) {
      try {
        await this._plugins[pluginName].onStart()
      }
      catch (e) {
        console.error(`error on core plugin [${pluginName}].onStart()`, e)
      }
    }
  }

  async onGlobalEventReceived(event: CoreGlobalEvent, info) {
    // console.log(`[${process.pid}] core.Muon.onGlobalEventReceived`, event)
    try {
      await this.emit(event.type, event.data, info);
    }catch (e) {}
  }

  get configDir(){
    let baseDir = `${process.env.PWD}/config`;
    return !!process.env.CONFIG_BASE_PATH ? `${baseDir}/${process.env.CONFIG_BASE_PATH}/` : baseDir
  }

  saveConfig(data, fileName){
    fs.writeFileSync(`${this.configDir}/${fileName}`, JSON.stringify(data, null, 2))
  }

  backupConfigFile(fileName){
    if(fs.existsSync(`${this.configDir}/${fileName}`)) {
      let content = fs.readFileSync(`${this.configDir}/${fileName}`);
      fs.writeFileSync(`${this.configDir}/${fileName}_[${new Date().toISOString()}].bak`, content)
    }
  }
}
