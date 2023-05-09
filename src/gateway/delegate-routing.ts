import { Router } from "express";
import * as NetworkIpc from "../network/ipc.js";
import { mixGetPost } from "./middlewares.js";
import { logger } from "@libp2p/logger";
import { muonSha3 } from "../utils/sha3.js";
import * as crypto from "../utils/crypto.js";
import { MuonNodeInfo } from "../common/types";
import asyncHandler from "express-async-handler";
import _ from "lodash";

const router = Router();
const log = logger("muon:gateway:routing");

type RoutingData = {
  timestamp: number;
  id: string;
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
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    let { id } = req.mixed;

    if (!id) throw `Missing parameter 'id'`;

    const peerInfos: MuonNodeInfo[] = await NetworkIpc.filterNodes({
      list: [id],
    })!;

    if (peerInfos.length < 1) throw `PeerId '${id}' not found`;

    const peerInfo = peerInfos[0];

    res.json({
      peerInfo: onlines[peerInfo.id]?.peerInfo,
    });
  })
);

router.use(
  "/query",
  mixGetPost,
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    const { peerId, cid } = req.mixed;
    if (!peerId && !cid) throw `Missing parameter: 'peerId' / 'cid'`;

    res.json({
      list: [],
    });
  })
);

function mergeRoutingData(routingData: RoutingData) {
  let { id } = routingData;
  if (!onlines[id]) {
    onlines[id] = routingData;
  } else {
    const oldRoutingData = onlines[id];
    const multiaddrs = [
      ...oldRoutingData.peerInfo.multiaddrs,
      ...routingData.peerInfo.multiaddrs,
    ].filter((ma) => !!ma);
    oldRoutingData.peerInfo.multiaddrs = _.uniq(multiaddrs);
    oldRoutingData.timestamp = routingData.timestamp;
  }
}

/**
 * This endpoint receives periodic requests
 * from the network nodes and saves their peerInfo
 */
router.use(
  "/discovery",
  mixGetPost,
  asyncHandler(async (req, res, next) => {
    // @ts-ignore
    const { timestamp, gatewayPort, peerInfo, signature } = req.mixed;

    if (!gatewayPort || !timestamp || !peerInfo || !signature)
      throw `Missing parameters`;

    if (
      !peerInfo?.multiaddrs ||
      !Array.isArray(peerInfo.multiaddrs) ||
      peerInfo.multiaddrs.length === 0
    )
      throw `Invalid multiaddrs`;

    let realPeerInfo: MuonNodeInfo[] = await NetworkIpc.filterNodes({
      list: [peerInfo.id],
    });
    if (realPeerInfo.length < 1) throw `Unknown peerId`;

    let hash = muonSha3(
      { type: "uint16", value: gatewayPort },
      { type: "uint64", value: timestamp },
      { type: "string", value: peerInfo.id },
      ...peerInfo.multiaddrs.map((value) => ({ type: "string", value }))
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
    let { duration = 60 } = req.mixed;

    const time = Date.now() - duration * 60000;
    res.json(Object.values(onlines).filter((p) => p.timestamp > time));
  })
);

export default router;
