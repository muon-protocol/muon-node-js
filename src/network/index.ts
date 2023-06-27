import mongoose from "mongoose";
import Events from "events-async";
import { create } from "./libp2p_bundle.js";
import { bootstrap } from "@libp2p/bootstrap";
import loadConfigs from "./configurations.js";
import { createFromJSON } from "@libp2p/peer-id-factory";
import {
  getNodeManagerDataFromCache,
  isPrivate,
  peerId2Str,
  tryAndGetNodeManagerData
} from "./utils.js";
import { MessagePublisher } from "../common/message-bus/index.js";
import NodeManagerPlugin, {NodeManagerPluginConfigs} from "./plugins/node-manager.js";
import LatencyCheckPlugin from "./plugins/latency-check.js";
import IpcHandlerPlugin from "./plugins/network-ipc-handler.js";
import IpcPlugin from "./plugins/network-ipc-plugin.js";
import RemoteCallPlugin from "./plugins/remote-call.js";
import NetworkBroadcastPlugin from "./plugins/network-broadcast.js";
import { logger } from "@libp2p/logger";
import {findMyIp, parseBool, timeout} from "../utils/helpers.js";
import { muonRouting } from "./muon-routing.js";

import * as NetworkIpc from "../network/ipc.js";
import MessageSubscriber from "../common/message-bus/msg-subscriber.js";
import {GLOBAL_EVENT_CHANNEL} from "../network/ipc.js";
import {CoreGlobalEvent} from "../core/ipc";
import {NodeManagerData} from "../common/types";

const log = logger("muon:network");

class Network extends Events {
  configs;
  libp2p;
  peerId;
  _plugins = {};
  on: (eventName: string, listener) => void;
  globalEventBus: MessageSubscriber = new MessageSubscriber(GLOBAL_EVENT_CHANNEL);

  constructor(configs) {
    super();
    this.configs = configs;
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

    log(`Node ready Listening on: ${this.configs.libp2p.port}`);

    log("====================== Bindings ====================");
    this.libp2p.getMultiaddrs().forEach((ma) => {
      log(ma.toString());
    });
    log("====================================================");

    // @ts-ignore
    this.globalEventBus.on("message", this.onGlobalEventReceived.bind(this));
    this._onceStarted();
  }

  async onGlobalEventReceived(event: CoreGlobalEvent, info) {
    // console.log(`[${process.pid}] core.Muon.onGlobalEventReceived`, event)
    try {
      // @ts-ignore
      await this.emit(event.type, event.data, info);
    }catch (e) {}
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

  // Waits a random time(0-5 secs) to avoid calling
  // RPC nodes by all network nodes at the same time
  // When the network restarts
  await timeout(Math.floor(Math.random()*5e3));

  log(`loading NodeManager data %o`,{chain: net.nodeManager.network, contract: net.nodeManager.address})
  let nodeManagerData: NodeManagerData;
  log("checking cache for NodeManager data ...")
  try {
    nodeManagerData = await getNodeManagerDataFromCache(net.nodeManager);
    log('NodeManager data loaded from cache.');
  }
  catch (e) {
    log('NodeManager data load from cache failed. loading from network ... %O', e)
    nodeManagerData = await tryAndGetNodeManagerData(net.nodeManager);
  }
  const maxId: number = nodeManagerData.nodes.reduce((max, n) => Math.max(max, parseInt(n.id)), 0);
  log(`${nodeManagerData.nodes.length} node info loaded. max id: ${maxId}`)

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
      "node-manager": [
        NodeManagerPlugin,
        {
          initialNodeManagerData: nodeManagerData
        } as NodeManagerPluginConfigs
      ],
      "latency": [LatencyCheckPlugin, {}],
      broadcast: [NetworkBroadcastPlugin, {}],
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
