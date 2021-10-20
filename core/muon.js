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

/**
 * Each wallet has a unique known index and will never change.
 */
// const MUON_WALLETS_INDEX = {
//   '0x06A85356DCb5b307096726FB86A78c59D38e08ee': 1,
//   '0x4513218Ce2e31004348Fd374856152e1a026283C': 2,
//   '0xe4f507b6D5492491f4B57f0f235B158C4C862fea': 3,
//   '0x2236ED697Dab495e1FA17b079B05F3aa0F94E1Ef': 4,
//   '0xCA40791F962AC789Fdc1cE589989444F851715A8': 5,
//   '0x7AA04BfC706095b748979FE3E3dB156C3dFb9451': 6,
//   '0x60AA825FffaF4AC68392D886Cc2EcBCBa3Df4BD9': 7,
//   '0x031e6efe16bCFB88e6bfB068cfd39Ca02669Ae7C': 8,
//   '0x27a58c0e7688F90B415afA8a1BfA64D48A835DF7': 9,
//   '0x11C57ECa88e4A40b7B041EF48a66B9a0EF36b830': 10
// }
const MUON_WALLETS_INDEX = {
  '0x53d1FE3Dc08956aFE143a1643Cf69732a5670a35': 1,
  '0x41BB2d6707204eE747e1403B921ED6BA39B59D67': 2,
  '0x2611B06F33A3B4d3621fDC987a8531BbeB639329': 3,
  '0xa6d4Bd80B3451157edeaa692b8120C2c25c40d2f': 4,
  '0x4B6ACE228BC58b6db94DC256a2A82aCc49E57f96': 5,
  '0xc7A8aE9b4327c60A18E60867622C8949a34E36e0': 6,
  '0x2801Cf74E14c28e4fD352295Dc4890f178E14A0C': 7,
  '0xccF9dB27edb5fEA7f11E1726bA4B08Ab5c419309': 8,
  '0x36f97563850C61c742117622c2895868D65A7E71': 9,
  '0x84D4E993AF33E218B2b016C41E2932961A0F526C': 10,
  '0x6D6A842fE114aF8953D23281B43DD7A0B17A6283': 11,
  '0x426076cd3eF80f049B3E71D31B79007e29fdB8bd': 12,
  '0x5C222e5F5188C5A160321e0ba5643217A7e50373': 13,
  '0xEB9285b77942e9c4A45f0E006275A64Cab0C8aa3': 14,
  '0x6E45788005B2fFcCd93A9Af13F02839ce3e4Ac4a': 15,
}

const MUON_SHARED_KEY_PUB = '041af2181eb3ed1d45997072ac530c075ab4142923dba6679c26cf86f7e67cd4ceb6df9e17f2a38ce12e74a491806f12d5e23f7204e110f73c7b02c13748d329ac';

class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}
  sharedWalletPubKey = tss.curve.keyFromPublic(MUON_SHARED_KEY_PUB, 'hex').getPublic();
  sharedWalletAddress = '0xaE0413251b6EE88aC3A6D039Dd2250C50baE19D7'

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

    console.log('muon started')
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart()
    }
  }

  getSharedWalletPubKey() {
    // return this.sharedWalletPubKey
    let tssPlugin = this.getPlugin('tss-plugin')
    return tssPlugin.tssKey.publicKey
  }

  getSharedWalletAddress() {
    return this.sharedWalletAddress
  }

  getNodesWalletList() {
    // return Object.keys(MUON_WALLETS_INDEX)
    let tssPlugin = this.getPlugin('tss-plugin')
    let partners = tssPlugin.tssKey.party.partners;
    return Object.keys(partners);
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
