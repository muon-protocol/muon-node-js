import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { noise } from "@chainsafe/libp2p-noise";
import { bootstrap } from "@libp2p/bootstrap";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import defaultsDeep from "@nodeutils/defaults-deep";
// import { LevelDatastore } from "datastore-level";
import { yamux } from '@chainsafe/libp2p-yamux';

const DEFAULT_OPTS = {
  // datastore: new LevelDatastore(`./muon-data/v2/${process.env.SIGN_WALLET_ADDRESS!.substr(-20)}/`),
  transports: [
    tcp(),
  ],
  connectionEncryption: [
    noise(),
  ],
  connectionManager: {
    maxConnections: Infinity, // TODO: set default values
    minConnections: 0,
    maxIncomingPendingConnections: 500, // TODO: set default values
    //dialTimeout: 10 * 1000
  },
  streamMuxers: [
    yamux(),
    mplex()
  ],
  services: {
    pubsub: gossipsub({allowPublishToZeroPeers: true})
  }


  // dht: kadDHT({
  //   kBucketSize: 20,
  //   clientMode: false,
  //   validators: {
  //     muon: async (key, data) => {
  //       // validate data1111
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
