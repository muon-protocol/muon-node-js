import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { noise } from "@chainsafe/libp2p-noise";
import { bootstrap } from "@libp2p/bootstrap";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import defaultsDeep from "@nodeutils/defaults-deep";
// import { LevelDatastore } from "datastore-level";

const DEFAULT_OPTS = {
  // datastore: new LevelDatastore(`./muon-data/v2/${process.env.SIGN_WALLET_ADDRESS!.substr(-20)}/`),
  transports: [
    tcp(),
  ],
  connectionEncryption: [
    noise(),
  ],
  connectionManager: {
    maxConnections: 1000,
    minConnections: 0,
    maxIncomingPendingConnections: 50,
    dialTimeout: 4 * 1000
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
  //       // validate data
  //       // throw an err when data is not valid
  //       return;
  //     },
  //   },
  //   selectors: {
  //     muon: (key, dataList) => {
  //       // select correct record
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
