'use strict'
/* eslint-disable no-console */
const Events = require('events')
const PeerId = require('peer-id')
const Node = require('./libp2p_bundle')
const chalk = require('chalk')
const emoji = require('node-emoji')
const tss = require('../utils/tss')

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
  '0x8AD44077C9F995Ed4195855c633E6635898a3570': 1,
  '0x8e23969555d98726a96FC7c2a3B3766CD770db06': 2,
  '0xf72aAA94D575027075F1AAA9d50DA00a1BdC82B0': 3,
  '0x7F775CE3Ff1455da3ef535B2Fa55972682B075C8': 4,
  '0xB1a515AE3382EE1D64D0243E63F92527B355dD3A': 5,
  '0x118B929C5A60fF1DE414d2939373672fBdA31a8B': 6,
  '0x48F18CB273E95eEF99484aBa0DAb55C1b3767758': 7,
  '0xD8A346e0D6f769591f8B80Ea973cd678f2C82c14': 8,
  '0x5874D7E49da77a1053BB215fBbB8e4Ccb8cC9D04': 9,
  '0x7dbedfb0B35606e4797560586A2D321EB72238DD': 10,
  '0xc66473fE901b9a7d4CBb6E755c4253958dc90435': 11,
  '0x37B391D04f3CCAbFE26e88D9d1E62B10F8c76a8E': 12,
  '0x88CB4cd50B72C353dad3b4b449e5b19962e98d04': 13,
  '0x771067192936711e67b1d063F3ef850637605E4e': 14,
  '0x43F3a390f07a624c04c610a8e78fC30310CF747D': 15,
}

const MUON_SHARED_KEY_PUB = '04d2a77c9664a807945590d4c98fbefe89951b27fc620f9e3e0047f49c7bf1587d212a3eca5d7145b30469d9ae24c2e9291e86f71962d08bcc823460506d988ce0';

class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}
  sharedWalletPubKey = tss.curve.keyFromPublic(MUON_SHARED_KEY_PUB, 'hex').getPublic();
  sharedWalletAddress = '0x8f720928474f259FaB29c2D6d871cA0ae1A620eE'

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
    console.log(
      emoji.get('moon'),
      chalk.green(` peer [${process.env.PEER_ID}] starting ...`)
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
