'use strict'
/* eslint-disable no-console */
const Events = require('events')
const PeerId = require('peer-id')
const Node = require('./libp2p_bundle')
const chalk = require('chalk')
const emoji = require('node-emoji')
const tss = require('../utils/tss')
const fs = require('fs')
const TimeoutPromise = require('./timeout-promise')


class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}

  constructor(configs) {
    super()
    this.configs = configs
    this.firstPeerConnect = new TimeoutPromise();
  }

  async initialize() {
    await this._initializeNetwork(this.configs.libp2p)
    await this._initializePlugin(this.configs.plugins)
  }

  async _initializeNetwork(configs) {
    let peerId = await PeerId.createFromJSON(configs.nodeId)

    let libp2p = await Node.create({
      peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${configs.port}`]
      },
      config: {
        peerDiscovery: {
          mdns: {
            interval: 20e3,
            enabled: true
          },
          [Node.Bootstrap.tag]: {
            list: [...configs.bootstrap],
            interval: 5000, // default is 10 ms,
            enabled: configs.bootstrap.length > 0
          }
        }
      }
    })

    libp2p.connectionManager.on('peer:connect', this.onPeerConnect.bind(this))
    libp2p.on('peer:discovery', this.onPeerDiscovery.bind(this))
    // libp2p._dht.on('peer', () => this.firstPeerConnect.resolve(true));

    this.peerId = peerId
    this.libp2p = libp2p
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

  onPeerConnect(connection){
    console.log(
      emoji.get('moon'),
      chalk.blue(' Node connected to '),
      emoji.get('large_blue_circle'),
      chalk.blue(` ${connection.remotePeer.toB58String()}`)
    )
    this.firstPeerConnect.resolve(true)
    this.emit('peer', connection.remotePeer)
  }

  onPeerDiscovery(peerId){
    this.emit('peer', peerId)
    this.firstPeerConnect.resolve(true)
    console.log('found peer: ', peerId.toB58String())
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
    console.log(
      emoji.get('moon'),
      chalk.green(` peer [${this.peerId.toB58String()}] starting ...`)
    )
    await this.libp2p.start()

    console.log(
      emoji.get('moon'),
      chalk.blue(' Node ready '),
      emoji.get('headphones'),
      chalk.blue(` Listening on: ${this.configs.libp2p.port}`)
    )

    if (this.libp2p.isStarted()) {
      this._onceStarted()
    } else {
      this.libp2p.once('start', this._onceStarted.bind(this))
    }
  }

  async _onceStarted() {
    // TODO:
    // console.log('waiting for first peer connect ...');
    // // wait for first peer connect;
    // await this.firstPeerConnect.waitToFulfill();

    console.log(`muon started (node-js version ${process.versions.node}).`)
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart()
    }
  }

  getSharedWalletPubKey() {
    // return this.sharedWalletPubKey
    let tssPlugin = this.getPlugin('tss-plugin')
    return tssPlugin.tssKey.publicKey
  }

  getNodesWalletIndex() {
    // return MUON_WALLETS_INDEX
    let tssPlugin = this.getPlugin('tss-plugin');
    // let partners = tssPlugin.tssKey.party.partners;
    if(!tssPlugin.tssParty)
      return {};
    let partners = tssPlugin.tssParty.partners;
    return Object.keys(partners).reduce((obj, w) => ({...obj, [w]: partners[w].i}), {})
  }

  get peerIdStr(){
    return this.peerId.toB58String();
  }

  get configDir(){
    let baseDir = `${process.env.PWD}/config/`
    return !!process.env.CONFIG_BASE_PATH ? `${baseDir}${process.env.CONFIG_BASE_PATH}/` : baseDir
  }

  saveConfig(data, fileName){
    fs.writeFileSync(`${this.configDir}/${fileName}`, JSON.stringify(data, null, 2))
  }
}

module.exports = Muon
