'use strict'
/* eslint-disable no-console */
const Events = require('events');
const PeerId = require('peer-id')
const Node = require('./libp2p_bundle')
const chalk = require('chalk');
const emoji = require('node-emoji')

class Muon extends Events{
  configs = {}
  peerId = null;
  libp2p = null;
  _plugins = {};

  constructor(configs){
    super();
    this.configs = configs
  }

  async initialize(){
    await this._initializeNetwork(this.configs.libp2p)
    await this._initializePlugin(this.configs.plugins)
  }

  async _initializeNetwork(configs){
    let peerId = await PeerId.createFromJSON(configs.nodeId)

    let libp2p = await Node.create({
      peerId,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${configs.port}`]
      },
      config: {
        peerDiscovery: {
          [Node.Bootstrap.tag]:{
            list: [
              ...configs.bootstrap,
            ],
            interval: 5000, // default is 10 ms,
            enabled: configs.bootstrap.length > 0,
          }
        }
      }
    })

    libp2p.connectionManager.on('peer:connect', (connection) => {
      console.log(emoji.get('moon'), chalk.blue(' Node connected to '),
        emoji.get('large_blue_circle'),
        chalk.blue(` ${connection.remotePeer.toB58String()}`));
    })

    libp2p.on('peer:discovery', function (peerId) {
      console.log('found peer: ', peerId.toB58String())
    })

    // setInterval(() => {
    //   nodeListener.pubsub.publish(REQUEST_BROADCAST_CHANNEL, uint8ArrayFromString('Hello world.'))
    // }, 1000)

    this.peerId = peerId;
    this.libp2p = libp2p;
  }

  _initializePlugin(plugins){
    for(let pluginName in plugins){
      let [plugin, configs] = plugins[pluginName]
      this._plugins[pluginName] = new plugin(this, configs)
    }
    console.log('plugins initialized.')
  }

  getPlugin(pluginName){
    return this._plugins[pluginName];
  }

  async start(){
    await this.libp2p.start()

    console.log(emoji.get('moon'),
      chalk.blue(' Node ready '),
      emoji.get('headphones'),
      chalk.blue(` Listening on: ${this.configs.libp2p.port}`)
    );

    for(let pluginName in this._plugins){
      this._plugins[pluginName].onStart()
    }
  }
}

module.exports = Muon;

