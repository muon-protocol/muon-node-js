const Libp2p = require('libp2p')
const TCP = require('libp2p-tcp')
const defaultsDeep = require('@nodeutils/defaults-deep')
const Bootstrap = require('libp2p-bootstrap')
const Multiplex = require('libp2p-mplex')
const SECIO = require('libp2p-secio')
const { NOISE } = require('libp2p-noise')
const Gossipsub = require('libp2p-gossipsub')
const KadDHT = require('libp2p-kad-dht');

const DEFAULT_OPTS = {
  modules: {
    transport: [
      TCP,
    ],
    peerDiscovery: [Bootstrap],
    connEncryption: [
      // SECIO,
      NOISE,
    ],
    streamMuxer: [
      Multiplex
    ],
    pubsub: Gossipsub,
    dht: KadDHT
  },
  config: {
    peerDiscovery: {
    },
    dht: {
      enabled: true
    }
  }
}

function create(opts) {
  return Libp2p.create(defaultsDeep(opts, DEFAULT_OPTS))
}

module.exports = {
  create,
  Bootstrap,
}
