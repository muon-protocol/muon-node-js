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
const isPrivate = require('libp2p-utils/src/multiaddr/is-private')


class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}
  _apps = {}

  constructor(configs) {
    super()
    this.configs = configs
  }

  async initialize() {
    await this._initializeNetwork(this.configs.libp2p)
    await this._initializePlugin(this.configs.plugins)
  }

  async _initializeNetwork(configs) {
    let peerId = await PeerId.createFromJSON(configs.nodeId)
    let announceFilter = (multiaddrs) => multiaddrs.filter(m => !isPrivate(m));
    if(process.env.DISABLE_ANNOUNCE_FILTER)
      announceFilter = mas => mas

    let libp2p = await Node.create({
      peerId,
      addresses: {
        listen: [
          `/ip4/${configs.host}/tcp/${configs.port}`,
          // `/ip4/${configs.host}/tcp/${configs.port}/p2p/${process.env.PEER_ID}`,
          // `/ip4/0.0.0.0/tcp/${parseInt(configs.port)+1}/ws`,
        ],
        announceFilter
      },
      config: {
        peerDiscovery: {
          [Node.Bootstrap.tag]: {
            list: [...configs.bootstrap],
            interval: 5000, // default is 10 ms,
            enabled: configs.bootstrap.length > 0
          }
        }
      }
    });

    libp2p.connectionManager.on('peer:connect', this.onPeerConnect.bind(this))
    libp2p.connectionManager.on('peer:disconnect', this.onPeerDisconnect.bind(this))
    libp2p.on('peer:discovery', this.onPeerDiscovery.bind(this))

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
    this.emit('peer', connection.remotePeer)
  }

  onPeerDisconnect(connection){
    console.log(
      emoji.get('moon'),
      chalk.red(' Node disconnected'),
      emoji.get('large_blue_circle'),
      chalk.red(` ${connection.remotePeer.toB58String()}`)
    );
    this.emit('peer:disconnect', connection.remotePeer)
  }

  async onPeerDiscovery(peerId){
    this.emit('peer', peerId)
    console.log('found peer');
    try {
      const peerInfo = await this.libp2p.peerRouting.findPeer(peerId)
      console.log({
        peerId: peerId.toB58String(),
        multiaddrs: peerInfo.multiaddrs,
        // peerInfo,
      })
    }catch (e) {
      console.log('Error Muon.onPeerDiscovery', e)
    }
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

    if(this.configs.libp2p.natIp) {
      let {port, natIp} = this.configs.libp2p
      this.libp2p.addressManager.addObservedAddr(`/ip4/${natIp}/tcp/${port}/p2p/${this.peerId.toB58String()}`);
    }

    console.log(
      emoji.get('moon'),
      chalk.blue(' Node ready '),
      emoji.get('headphones'),
      chalk.blue(` Listening on: ${this.configs.libp2p.port}`)
    )

    // if(process.env.VERBOSE) {
      console.log("====================== Bindings ====================")
      this.libp2p.multiaddrs.forEach((ma) => {
        console.log(ma.toString())
        // console.log(`${ma.toString()}/p2p/${this.libp2p.peerId.toB58String()}`)
      })
      console.log("====================================================")
    // }

    if (this.libp2p.isStarted()) {
      this._onceStarted();
    } else {
      this.libp2p.once('start', this._onceStarted.bind(this))
    }
  }

  async _onceStarted() {
    console.log(`muon started at ${new Date()} (node-js version ${process.versions.node}).`)
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart()
    }
  }

  getSharedWalletPubKey() {
    // return this.sharedWalletPubKey
    let tssPlugin = this.getPlugin('tss-plugin')
    return tssPlugin.tssKey.publicKey
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
