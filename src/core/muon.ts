'use strict'
/* eslint-disable no-console */
import {CoreGlobalEvent} from "./ipc";

const Events = require('events')
const chalk = require('chalk')
const emoji = require('node-emoji')
const fs = require('fs')
const { MessagePublisher, MessageSubscriber } = require('../common/message-bus')
const { GLOBAL_EVENT_CHANNEL, fireEvent } = require('./ipc')
import * as NetworkIpc from '../networking/ipc'
import MuonBasePlugin from './plugins/base/base-plugin';

export interface MuonPlugin {
  constructor(network: MuonBasePlugin, configs: MuonPluginConfigs);
  onInit();
  onStart();
}

export type MuonPluginConfigs = any

export type MuonConfigs = {
  plugins: {[index: string]: [MuonPlugin, MuonPluginConfigs]}
}

export default class Muon extends Events {
  configs: MuonConfigs
  _plugins = {}
  _apps = {}
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
      this._plugins[pluginName] = new plugin(this, configs)
      this._plugins[pluginName].onInit();
    }
    // console.log('plugins initialized.')
  }

  getPlugin(pluginName) {
    return this._plugins[pluginName]
  }

  getAppByName(appName) {
    if (!appName) return null
    let keys = Object.keys(this._plugins)
    for (let i = 0; i < keys.length; i++) {
      if (this._plugins[keys[i]].APP_NAME === appName)
        return this._plugins[keys[i]]
    }
    return null
  }

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

  async onGlobalEventReceived(event: CoreGlobalEvent) {
    // console.log(`[${process.pid}] core.Muon.onGlobalEventReceived`, event)
    this.emit(event.type, event.data);
  }

  getSharedWalletPubKey() {
    // return this.sharedWalletPubKey
    let tssPlugin = this.getPlugin('tss-plugin')
    return tssPlugin.tssKey.publicKey
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
