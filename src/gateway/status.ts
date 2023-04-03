import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import lodash from 'lodash'
import asyncHandler from 'express-async-handler'
import {getCommitId, readFileTail} from "../utils/helpers.js";

const NodeAddress = process.env.SIGN_WALLET_ADDRESS || null;
const PeerID = process.env.PEER_ID || null
const shieldForwardUrl = process.env.SHIELD_FORWARD_URL || null
const shieldedApps = (process.env.SHIELDED_APPS || "").split('|').filter(v => !!v)

const router = Router();

router.use('/', asyncHandler(async (req, res, next) => {
  const [netConfig, nodeInfo, multiAddress, uptime, commitId] = await Promise.all([
    NetworkIpc.getNetworkConfig().catch(e => null),
    NetworkIpc.getCurrentNodeInfo({
      timeout: 5000,
      timeoutMessage: "Getting current node info timed out"
    }).catch(e => null),
    NetworkIpc.getNodeMultiAddress().catch(e => null),
    NetworkIpc.getUptime().catch(e => null),
    getCommitId().catch(e => null)
  ]);

  let autoUpdateLogs: string|undefined = undefined;
  if(req.query.au !== undefined) {
    // @ts-ignore
    const n = parseInt(req.query.au) || 100;
    autoUpdateLogs = await readFileTail("auto-update.log", n);
  }

  let discordVerification=process.env.DISCORD_VERIFICATION;

  res.json({
    discordVerification,
    staker: nodeInfo ? nodeInfo.staker : undefined,
    address: NodeAddress,
    peerId: PeerID,
    networkingPort: process.env.PEER_PORT,
    node: {
      addedToNetwork: !!nodeInfo,
      staker: nodeInfo ? nodeInfo.staker : undefined,
      address: NodeAddress,
      peerId: PeerID,
      networkingPort: process.env.PEER_PORT,
      uptime,
      commitId,
      autoUpdateLogs,
    },
    managerContract: {
      network: netConfig?.nodeManager?.network,
      address: netConfig?.nodeManager?.address,
    },
    shield:{
      enable: !!shieldForwardUrl,
      apps: shieldedApps
    },
    addedToNetwork: !!nodeInfo,
    network: {
      nodeInfo: nodeInfo ? lodash.omit(nodeInfo || {}, ['peerId', 'wallet', 'staker','isOnline']) : undefined,
      address: multiAddress,
    }
  })
}))

export default router;
