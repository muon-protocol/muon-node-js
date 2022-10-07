'use strict'
/* eslint-disable no-console */
import {CoreGlobalEvent} from "./ipc";

const Events = require('events')
const chalk = require('chalk')
const emoji = require('node-emoji')
const fs = require('fs')
const { MessagePublisher, MessageSubscriber } = require('../common/message-bus')
const { GLOBAL_EVENT_CHANNEL, fireEvent } = require('./ipc')
import * as NetworkIpc from '../network/ipc'
import MuonBasePlugin from './plugins/base/base-plugin';
import BaseAppPlugin from "./plugins/base/base-app-plugin";
import BasePlugin from "./plugins/base/base-plugin";
import {Constructor} from "../common/types";

export type MuonPluginConfigs = any

export type MuonConfigs = {
  plugins: {[index: string]: [Constructor<BasePlugin>, MuonPluginConfigs]},
  tss: {
    party: {
      id: string,
      t: number,
      max: number
    },
    key: {
      id: string,
      share: string,
      publicKey: string,
      address: string
    }
  },
  net: {
    tss: {
      threshold: number,
      max: number
    },
    collateralWallets: string[]
  },
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

  _initializePlugin(plugins) {
    for (let pluginName in plugins) {
      let [plugin, configs] = plugins[pluginName]

      const pluginInstance = new plugin(this, configs)
      this._plugins[pluginName] = pluginInstance
      pluginInstance.onInit();

      if(pluginInstance instanceof BaseAppPlugin) {
        if(pluginInstance.APP_NAME) {
          this._apps[pluginInstance.APP_ID] = pluginInstance;
          this.appIdToNameMap[pluginInstance.APP_ID] = pluginInstance.APP_NAME
          this.appNameToIdMap[pluginInstance.APP_NAME] = pluginInstance.APP_ID
        }
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
    this.globalEventBus.on("message", this.onGlobalEventReceived.bind(this));
    this._onceStarted();

    setTimeout(async () => {
      const peerIds = await NetworkIpc.getOnlinePeers()
      if(peerIds.length > 0) {
        peerIds.forEach(peerId => {
          fireEvent({type: "peer:discovery", data: peerId})
        })
      }
    }, 1000);
  }

  async _onceStarted() {
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart()
    }
  }

  async onGlobalEventReceived(event: CoreGlobalEvent, info) {
    // console.log(`[${process.pid}] core.Muon.onGlobalEventReceived`, event)
    this.emit(event.type, event.data, info);
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
