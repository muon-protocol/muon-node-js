'use strict'
/* eslint-disable no-console */
const Events = require('events')
const PeerId = require('peer-id')
const Node = require('./libp2p_bundle')
const chalk = require('chalk')
const emoji = require('node-emoji')
const ECPoint = require('../utils/tss/point')

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
  '0x56306C726cDBE693edA670b22610E1a6222957F0': 1,
  '0x3FB03F24456B01E2C71b991A090CCe9bF64AF2B1': 2,
  '0x9e2faF5BF5A96A75e0b3A8A3AbbD3b9B5E12e800': 3,
  '0x475Ff8a8E9D37441D2c32B9C66991599D063Af77': 4,
  '0xC522a53131B8Bfd15F9F8A9bA25E00655671C592': 5,
}

class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}
  sharedWalletPubKey = new ECPoint(
    '0x26da8d7976d5559e6a298962c325044c16a9a25a89bfa0032950fe4685ec48a8',
    '0x69e142a7c4bdb5ebfcee08ad89ce4d8f5f69080e1e00067d3189d1c57ec49141'
  );
  sharedWalletAddress = '0x8e8C5DfF0c4386b0d91320dfD8d446fD2Ba9b403'

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

    libp2p.connectionManager.on('peer:connect', (connection) => {
      console.log(
        emoji.get('moon'),
        chalk.blue(' Node connected to '),
        emoji.get('large_blue_circle'),
        chalk.blue(` ${connection.remotePeer.toB58String()}`)
      )
    })

    libp2p.on('peer:discovery', function (peerId) {
      console.log('found peer: ', peerId.toB58String())
    })

    // setInterval(() => {
    //   nodeListener.pubsub.publish(REQUEST_BROADCAST_CHANNEL, uint8ArrayFromString('Hello world.'))
    // }, 1000)

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

  _onceStarted() {
    console.log('muon started')
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart()
    }
  }

  getSharedWalletPubKey() {
    return this.sharedWalletPubKey
  }

  getSharedWalletAddress() {
    return this.sharedWalletAddress
  }

  getNodesWalletList() {
    return Object.keys(MUON_WALLETS_INDEX)
  }

  getNodesWalletIndex() {
    return MUON_WALLETS_INDEX
  }
}

module.exports = Muon
