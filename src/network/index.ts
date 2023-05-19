import NetworkContentPlugin from "./plugins/content-plugin.js";
import mongoose from "mongoose";
import Events from "events-async";
import { create } from "./libp2p_bundle.js";
import { bootstrap } from "@libp2p/bootstrap";
// import {pubsubPeerDiscovery} from "@libp2p/pubsub-peer-discovery";
// import { mdns } from '@libp2p/mdns'
import loadConfigs from "./configurations.js";
import { createFromJSON } from "@libp2p/peer-id-factory";
import chalk from "chalk";
import emoji from "node-emoji";
import { isPrivate, peerId2Str } from "./utils.js";
import * as CoreIpc from "../core/ipc.js";
import { MessagePublisher } from "../common/message-bus/index.js";
import NodeManagerPlugin from "./plugins/node-manager.js";
import IpcHandlerPlugin from "./plugins/network-ipc-handler.js";
import IpcPlugin from "./plugins/network-ipc-plugin.js";
import RemoteCallPlugin from "./plugins/remote-call.js";
import NetworkBroadcastPlugin from "./plugins/network-broadcast.js";
// import NetworkDHTPlugin from "./plugins/network-dht.js";
import { logger } from "@libp2p/logger";
import { findMyIp, parseBool } from "../utils/helpers.js";
import { muonRouting } from "./muon-routing.js";

import * as NetworkIpc from "../network/ipc.js";
import { MuonNodeInfo } from "../common/types";

const log = logger("muon:network");

class Network extends Events {
  configs;
  libp2p;
  peerId;
  _plugins = {};
  private connectedPeers: { [index: string]: boolean } = {};

  constructor(configs) {
    super();
    this.configs = configs;
  }

  getConnectedPeers(): { [index: string]: boolean } {
    return this.connectedPeers;
  }

  async _initializeLibp2p() {
    log(`libp2p initializing ...`);
    const configs = this.configs.libp2p;
    const netConfig = this.configs.net;
    let peerId = await createFromJSON(configs.peerId);

    const peerDiscovery: any[] = [
      // mdns({
      //   interval: 60e3
      // }),
    ];
    let bootstrapList: string[] = netConfig.bootstrap ?? [];
    /** exclude self address */
    bootstrapList = bootstrapList.filter((bs) => {
      let peerId = bs.split("p2p/")[1];
      return !!peerId && peerId !== process.env.PEER_ID;
    });
    if (bootstrapList.length > 0) {
      peerDiscovery.push(
        bootstrap({
          // timeout: 5e3,
          list: bootstrapList,
        })
      );
    }

    const peerRouters: any[] = [];

    if (
      Array.isArray(netConfig.routing?.delegate) &&
      netConfig.routing.delegate.length > 0
    ) {
      let discoveryInterval = 3 * 60e3;
      if (process.env.DISCOVERY_INTERVAL) {
        if (parseInt(process.env.DISCOVERY_INTERVAL) >= 10e3)
          discoveryInterval = parseInt(process.env.DISCOVERY_INTERVAL);
      }
      peerRouters.push(
        muonRouting({
          baseUrls: netConfig.routing.delegate,
          discoveryInterval,
        })
      );
    }

    const announce: string[] = [];

    /** disable for devnet */
    let myIp;
    if (!parseBool(process.env.DISABLE_PUBLIC_IP_ANNOUNCE!)) {
      log("finding public ip ...");
      try {
        myIp = await findMyIp();
        if (!!myIp) {
          log(`public ip: %s`, myIp);
          announce.push(
            `/ip4/${myIp}/tcp/${configs.port}/p2p/${process.env.PEER_ID}`
          );
          log(`announce public address: %s`, announce[0]);
        }
      } catch (e) {
        log.error(`error when loading public ip %s`, e.message);
      }
    }

    let announceFilter = (multiaddrs) => {
      // remove myIp if a public IP is already in the list
      let filtered = multiaddrs.filter(
        (m) => !isPrivate(m) && m.nodeAddress()["address"] != myIp
      );
      if (filtered.length == 0) {
        return multiaddrs.filter((m) => !isPrivate(m));
      }
      return filtered;
    };

    if (process.env.DISABLE_ANNOUNCE_FILTER) announceFilter = (mas) => mas;

    const libp2p = await create({
      peerId,
      addresses: {
        listen: [
          `/ip4/${configs.host}/tcp/${configs.port}`
        ],
        announceFilter,
        announce,
      },
      peerDiscovery,
      peerRouters,
      connectionGater: {
        denyInboundEncryptedConnection: (peerId, maConn) => {
          let peerIdStr = peerId.toString();

          // deny connection if the node is not a valid
          // muon node.

          // Note: a node that deactivates will not disconnect right away
          // and its connection will remain open

          return NetworkIpc.filterNodes({
            list: [peerIdStr],
          }).then((peers) => {
            return peers.length == 0;
          });
        },
      },
      // config: {
      //   peerDiscovery: {
      //     // [Libp2pBundle.Bootstrap.tag]: {
      //     //   list: [...configs.bootstrap],
      //     //   interval: 5000, // default is 10 ms,
      //     //   enabled: configs.bootstrap.length > 0,
      //     // },
      //   },
      // },
    });
    libp2p.addEventListener("peer:connect", this.onPeerConnect.bind(this));
    libp2p.addEventListener(
      "peer:disconnect",
      this.onPeerDisconnect.bind(this)
    );

    // libp2p.addEventListener("peer:discovery", this.onPeerDiscovery.bind(this));

    this.peerId = peerId;
    this.libp2p = libp2p;
  }

  async _initializePlugin() {
    const { plugins } = this.configs;
    for (let pluginName in plugins) {
      const [plugin, configs] = plugins[pluginName];
      this._plugins[pluginName] = new plugin(this, configs);
      await this._plugins[pluginName].onInit();
    }
    log("plugins initialized.");
  }

  getPlugin(pluginName) {
    return this._plugins[pluginName];
  }

  async start() {
    log(`libp2p starting peerId: ${peerId2Str(this.peerId)} ...`);
    await this.libp2p.start();

    if (this.configs.libp2p.natIp) {
      let { port, natIp } = this.configs.libp2p;
    }

    log(
      emoji.get("moon") +
        " " +
        chalk.blue(" Node ready ") +
        " " +
        emoji.get("headphones") +
        " " +
        chalk.blue(` Listening on: ${this.configs.libp2p.port}`)
    );

    log("====================== Bindings ====================");
    this.libp2p.getMultiaddrs().forEach((ma) => {
      log(ma.toString());
    });
    log("====================================================");
    this._onceStarted();
  }

  async _onceStarted() {
    log(
      `muon started at ${new Date()} (node-js version ${
        process.versions.node
      }).`
    );
    for (let pluginName in this._plugins) {
      this._plugins[pluginName].onStart().catch((e) => {
        console.error(`network: plugins start error`, e);
      });
    }
  }

  // async onPeerDiscovery(evt) {
  //   const peer = evt.detail;
  //   const peerId = peer.id;
  //   this.connectedPeers[peerId2Str(peerId)] = true;
  //   // @ts-ignore
  //   this.emit("peer:discovery", peerId);
  //   CoreIpc.fireEvent({ type: "peer:discovery", data: peerId2Str(peerId) });
  //   log("found peer");
  //   try {
  //     log("discovered peer info %s", peerId2Str(peerId));
  //   } catch (e) {
  //     console.log("Error Muon.onPeerDiscovery", e);
  //   }
  // }

  onPeerConnect(evt) {
    const peerId = evt.detail;
    log(
      emoji.get("moon") +
        " " +
        chalk.blue(" Node connected to ") +
        " " +
        emoji.get("large_blue_circle") +
        " " +
        chalk.blue(` ${peerId2Str(peerId)}`)
    );
    this.connectedPeers[peerId2Str(peerId)] = true;
    // @ts-ignore
    this.emit("peer:connect", peerId);
    CoreIpc.fireEvent({
      type: "peer:connect",
      data: peerId2Str(peerId),
    });
  }

  onPeerDisconnect(evt) {
    const peerId = evt.detail;
    delete this.connectedPeers[peerId2Str(peerId)];
    log(
      emoji.get("moon") +
        " " +
        chalk.red(" Node disconnected") +
        " " +
        emoji.get("large_blue_circle") +
        " " +
        chalk.red(` ${peerId2Str(peerId)}`)
    );
    // @ts-ignore
    this.emit("peer:disconnect", peerId);
    CoreIpc.fireEvent({
      type: "peer:disconnect",
      data: peerId2Str(peerId),
    });
  }
}

function getLibp2pBootstraps() {
  return Object.keys(process.env)
    .filter((key) => key.startsWith("PEER_BOOTSTRAP_"))
    .map((key) => process.env[key])
    .filter((val) => val != undefined);
}

function clearMessageBus() {
  let mp = new MessagePublisher("temp");
  const redis = mp.sendRedis;
  return new Promise((resolve, reject) => {
    redis.keys(`${mp.channelPrefix}*`, function(err, rows) {
      if (err) return reject(err);
      for (var i = 0, j = rows.length; i < j; ++i) {
        redis.del(rows[i]);
      }
      resolve(true);
    });
  });
}

async function start() {
  log("connecting to mongodb ...");
  await mongoose.connect(process.env.MONGODB_CS!, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  if (!mongoose.connection) throw "Error connecting to MongoDB";

  log(`MongoDB successfully connected.`);

  log("starting ...");
  await clearMessageBus();

  let { net, tss } = await loadConfigs();

  if (!process.env.PEER_PORT) {
    throw { message: "peer listening port should be defined in .env file" };
  }
  if (
    !process.env.PEER_ID ||
    !process.env.PEER_PUBLIC_KEY ||
    !process.env.PEER_PRIVATE_KEY
  ) {
    throw { message: "peerId info should be defined in .env file" };
  }
  let configs = {
    libp2p: {
      peerId: {
        id: process.env.PEER_ID,
        pubKey: process.env.PEER_PUBLIC_KEY,
        privKey: process.env.PEER_PRIVATE_KEY,
      },
      natIp: process.env.PEER_NAT_IP,
      host: process.env.PEER_HOST || "0.0.0.0",
      port: process.env.PEER_PORT,
      bootstrap: getLibp2pBootstraps(),
    },
    plugins: {
      "node-manager": [NodeManagerPlugin, {}],
      broadcast: [NetworkBroadcastPlugin, {}],
      content: [NetworkContentPlugin, {}],
      "remote-call": [RemoteCallPlugin, {}],
      ipc: [IpcPlugin, {}],
      "ipc-handler": [IpcHandlerPlugin, {}],
      // dht: [NetworkDHTPlugin, {}]
    },
    net,
    // TODO: pass it into the tss-plugin
    tss,
  };
  const network = new Network(configs);
  // TODO: check this two line swap
  await network._initializeLibp2p();
  await network._initializePlugin();
  await network.start();
}

export { Network, start };
