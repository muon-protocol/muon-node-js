import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { mplex } from "@libp2p/mplex";
import { noise } from "@chainsafe/libp2p-noise";
import { kadDHT } from "@libp2p/kad-dht";
import { bootstrap } from "@libp2p/bootstrap";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import defaultsDeep from "@nodeutils/defaults-deep";
import { LevelDatastore } from "datastore-level";

const DEFAULT_OPTS = {
  // TODO: move path to env
  // datastore: new LevelDatastore(`./muon-data/v2/${process.env.SIGN_WALLET_ADDRESS!.substr(-20)}/`),
  transports: [
    tcp({
      // default timeout is 5 mins and nodes disconnect
      // once per 5 mins. It could increase load of dht
      outboundSocketInactivityTimeout: 30 * 60e3,
      inboundSocketInactivityTimeout: 30 * 60e3,
    }),
    // webSockets()
  ],
  connectionEncryption: [
    noise(),
  ],
  connectionManager: {
    autoDial: false,
    maxConnections: 3000,
    minConnections: 10,
    maxIncomingPendingConnections: 10
  },
  streamMuxers: [
    mplex()
  ],
  pubsub: gossipsub({
    allowPublishToZeroPeers: true,
  }),

  // dht: kadDHT({
  //   kBucketSize: 20,
  //   clientMode: false,
  //   validators: {
  //     muon: async (key, data) => {
  //       //TODO: validate data
  //       // throw an err when data is not valid
  //       return;
  //     },
  //   },
  //   selectors: {
  //     muon: (key, dataList) => {
  //       //TODO: select correct record
  //       return 0;
  //     },
  //   },
  // }),

};

function create(opts) {
  return createLibp2p(defaultsDeep(opts, DEFAULT_OPTS));
}

export {
  create
}
