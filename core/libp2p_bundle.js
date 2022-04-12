const Libp2p = require('libp2p')
const TCP = require('libp2p-tcp')
const WS = require('libp2p-websockets');
const defaultsDeep = require('@nodeutils/defaults-deep')
const Bootstrap = require('libp2p-bootstrap')
const Multiplex = require('libp2p-mplex')
import MulticastDNS from 'libp2p-mdns'
const SECIO = require('libp2p-secio')
const { NOISE } = require('libp2p-noise')
const Gossipsub = require('libp2p-gossipsub')
const KadDHT = require('libp2p-kad-dht')

const DEFAULT_OPTS = {
  dialer: {
    maxParallelDials: 150, // 150 total parallel multiaddr dials
    maxDialsPerPeer: 4, // Allow 4 multiaddrs to be dialed per peer in parallel
    dialTimeout: 10e3 // 10 second dial timeout per peer dial
  },
  modules: {
    transport: [
      TCP,
      WS,
    ],
    peerDiscovery: [
      MulticastDNS
    ],
    connEncryption: [
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
      autoDial: true,
      [MulticastDNS.tag]: {
        enabled: true
      },
      // Optimization
      // Requiring bootstrap inline in components/libp2p to reduce the cli execution time
      // [Bootstrap.tag] = 'bootstrap'
      bootstrap: {
        enabled: true
      }
    },
    dht: {
      enabled: true
    },
    pubsub: {
      enabled: true,
      emitSelf: false
    },
    nat: {
      enabled: true,
      // description: `ipfs@${os.hostname()}`
    }
  },
  metrics: {
    enabled: true
  },
  peerStore: {
    persistence: true
  }
}

function create(opts) {
  return Libp2p.create(defaultsDeep(opts, DEFAULT_OPTS))
}

module.exports = {
  create,
  Bootstrap,
}
