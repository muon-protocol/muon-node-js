import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { mplex } from "@libp2p/mplex";
import { noise } from "@chainsafe/libp2p-noise";
import { kadDHT } from "@libp2p/kad-dht";
import { bootstrap } from "@libp2p/bootstrap";
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import defaultsDeep from '@nodeutils/defaults-deep';

const DEFAULT_OPTS = {
  transports: [
    tcp(),
    webSockets()
  ],
  peerDiscovery: [
    // bootstrap,
    pubsubPeerDiscovery({
      interval: 1000
    })
  ],
  connectionEncryption: [
    noise(),
  ]
  ,connectionManager: {
    autoDial: true
  },
  streamMuxers: [
    mplex()
  ],
  pubsub: gossipsub(),
  dht: kadDHT({
    // validators: {
    //   muon: (data, key) => {
    //     console.log(
    //       `node ${port} validator:data,key`,
    //       uint8ArrayToString(data),
    //       uint8ArrayToString(key)
    //     );
    //     return true; // this record is always valid
    //   },
    // },
    // selectors: {
    //   muon: (data1, data2) => {
    //     console.log(
    //       `node ${port} selector:data1,data2`,
    //       uint8ArrayToString(data1),
    //       data2
    //     );
    //     return 1; // when multiple records are found for a given key, just select the first one
    //   },
    // },
  }),
  // config: {
  //   peerDiscovery: {
  //   },
  //   dht: {
  //     enabled: true
  //   },
  //   // pubsub: {
  //   //   emitSelf: false
  //   // }
  // }
}

function create(opts) {
  return createLibp2p(defaultsDeep(opts, DEFAULT_OPTS))
}

export {
  create,
  bootstrap
}
