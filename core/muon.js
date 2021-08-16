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
  '0xe555c91C8c95ff6e5738D40db8D2A6eA3031b36c': 1,
  '0x2182d2A71e9A017FdcbC6a4cc02b4a1B7DDc3142': 2,
  '0x6021E9CE15ecECbB39c8E67480Cc16e58Baa58fB': 3,
  '0x173D314e660fbbd6CA667E3091e5c486293c9AEA': 4,
  '0x9AFB3A216161cf64D5be15417f7D6175d63882c2': 5,
  '0xAFD18A22bC17493c44e7DdD197284D8ff719E19e': 6,
  '0x41ad356598211ce70903062213c1E28EA4B9FD6f': 7,
  '0x7c3A084D74425305Ccb4296be35028F41DB1f738': 8,
  '0xc2b9Fb60af2c3826152B258C6055a5DF32300c18': 9,
  '0xb60AF009C6b71f73f4d3F324bd3D84689019F2E2': 10,
  '0xB19c651ea5c4E4E1D7da798efA2Cc68B711daF56': 11,
  '0xEBC2F3F4AF867E2d0bfB1893A7911FEccfbe599d': 12,
  '0x37c098B92Cc6c4f2A636FAFA95c35D9D110cac3D': 13,
  '0x5b1D8358Dd2C15A40A1Da0144fba0d8D1bef6354': 14,
  '0xdc21D3BF547Fe6f2514e54Ae4cE4Bf6204339cE8': 15,
}

class Muon extends Events {
  configs = {}
  peerId = null
  libp2p = null
  _plugins = {}
  sharedWalletPubKey = new ECPoint(
    '0xd2a77c9664a807945590d4c98fbefe89951b27fc620f9e3e0047f49c7bf1587d',
    '0x212a3eca5d7145b30469d9ae24c2e9291e86f71962d08bcc823460506d988ce0'
  );
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
