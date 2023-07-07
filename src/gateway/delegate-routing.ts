import {Router} from "express";
import * as NetworkIpc from "../network/ipc.js";
import {mixGetPost, rateLimit} from "./middlewares.js";
import {logger} from "@libp2p/logger";
import {muonSha3} from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import {MuonNodeInfo} from "../common/types";
import {multiaddr} from "@multiformats/multiaddr";
import asyncHandler from "express-async-handler";
import {validateMultiaddrs, validateTimestamp} from "../network/utils.js";
import {loadGlobalConfigs} from "../common/configurations.js";
import {GatewayGlobalConfigs} from "./configurations";

const router = Router();
const log = logger("muon:gateway:routing");

const configs = loadGlobalConfigs('net.conf.json', 'default.net.conf.json');
const delegateRoutingTTL = parseInt(configs.routing.delegateRoutingTTL);
const discoveryValidPeriod = parseInt(configs.routing.discoveryValidPeriod);
const findPeerValidPeriod = parseInt(configs.routing.findPeerValidPeriod);
const gatewayConfigs: GatewayGlobalConfigs = loadGlobalConfigs('gateway.conf.json', 'default.gateway.conf.json');

type RoutingData = {
  timestamp: number;
  id: string;
  wallet: string;
  gatewayPort: number;
  peerInfo: {
    id: string;
    multiaddrs: string[];
    protocols: [];
  };
};
const onlines: { [index: string]: RoutingData } = {};

/**
 * Returns peerInfo for the given id
 */
router.use(
  "/findpeer",
  mixGetPost,
  rateLimit({
    enabled: gatewayConfigs.delegates.rateLimit.findPeerEnabled,
    points: gatewayConfigs.delegates.rateLimit.findPeerLimit,
    duration: gatewayConfigs.delegates.rateLimit.findPeerDuration,
  }),
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    const {id, timestamp, signature, requesterId} = req.mixed;

    if (!id || !timestamp || !signature || !requesterId)
      throw `Missing parameters`;

    let requesterOnlinePeer = onlines[requesterId];
    let targetOnlinePeer = onlines[id];

    if (!requesterOnlinePeer)
      throw `Invalid request source`;
    if (!targetOnlinePeer)
      throw `PeerId '${id}' not found`;

    validateTimestamp(timestamp, findPeerValidPeriod);

    if (!hasCommonContext(requesterOnlinePeer, targetOnlinePeer))
      throw `Access denied`;

    if (Date.now() - targetOnlinePeer.timestamp > delegateRoutingTTL)
      throw `PeerId '${id}' expired`;

    const requesterIp = req.ip;
    // @ts-ignore
    const isNodeIP = requesterOnlinePeer.peerInfo.multiaddrs.some(ma => multiaddr(ma).nodeAddress().address == requesterIp);

    if (!isNodeIP) {
      //Validate signature
      const hash = muonSha3(
        {type: "uint64", value: timestamp},
        {type: "string", value: `${requesterId}`},
      );
      const wallet = crypto.recover(hash, signature);
      if (wallet != requesterOnlinePeer.wallet)
        throw `Invalid signature`;
    }

    res.json({
      peerInfo: targetOnlinePeer?.peerInfo
    });
  })
);

function mergeRoutingData(routingData: RoutingData) {
  let {id} = routingData.peerInfo;
  onlines[id] = routingData;
}

/**
 * This endpoint receives periodic requests
 * from the network nodes and saves their peerInfo
 */
router.use(
  "/discovery",
  mixGetPost,
  rateLimit({
    enabled: gatewayConfigs.delegates.rateLimit.discoveryEnabled,
    points: gatewayConfigs.delegates.rateLimit.discoveryLimit,
    duration: gatewayConfigs.delegates.rateLimit.discoveryDuration,
  }),
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    const {timestamp, gatewayPort, peerInfo, signature} = req.mixed;

    if (!gatewayPort || !timestamp || !peerInfo || !signature)
      throw `Missing parameters`;


    validateTimestamp(timestamp, discoveryValidPeriod);

    if (!validateMultiaddrs(peerInfo?.multiaddrs))
      throw `Invalid multiaddrs`;

    let realPeerInfo: MuonNodeInfo[] = await NetworkIpc.filterNodes({
      list: [peerInfo.id],
    });
    if (realPeerInfo.length < 1) throw `Unknown peerId`;

    let hash = muonSha3(
      {type: "uint16", value: gatewayPort},
      {type: "uint64", value: timestamp},
      {type: "string", value: peerInfo.id},
      ...peerInfo.multiaddrs.map((value) => ({type: "string", value}))
    );
    // @ts-ignore
    const wallet = crypto.recover(hash, signature);
    if (wallet !== realPeerInfo[0].wallet) {
      log("Invalid dicovery signature, ${peerInfo.id}");
      throw `Invalid signature`;
    }

    mergeRoutingData({
      timestamp,
      id: realPeerInfo[0].id,
      gatewayPort,
      peerInfo,
      wallet
    });

    log(`PeerInfo updated successfully %s`, peerInfo.id);
    res.json({
      success: true,
    });
  })
);


/**
 Lists online nodes filtered by online duration.
 (default duration: 60 minutes)
 */
router.use(
  "/onlines",
  mixGetPost,
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    let {duration = 60} = req.mixed;

    const time = Date.now() - duration * 60000;
    res.json(Object.values(onlines).filter((p) => p.timestamp > time));
  })
);

function hasCommonContext(peerId1, peerId2) {
  return true;
}

export default router;