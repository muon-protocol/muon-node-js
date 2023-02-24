import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import lodash from 'lodash'
import asyncHandler from 'express-async-handler'
import {getCommitId} from "../utils/helpers.js";

const NodeAddress = process.env.SIGN_WALLET_ADDRESS || null;
const PeerID = process.env.PEER_ID || null
const shieldForwardUrl = process.env.SHIELD_FORWARD_URL || null
const shieldedApps = (process.env.SHIELDED_APPS || "").split('|').filter(v => !!v)

const router = Router();

router.use('/', asyncHandler(async (req, res, next) => {
  const [collateralInfo, nodeInfo, multiAddress, uptime, commitId] = await Promise.all([
    NetworkIpc.getCollateralInfo().catch(e => null),
    NetworkIpc.getCurrentNodeInfo().catch(e => null),
    NetworkIpc.getNodeMultiAddress().catch(e => null),
    NetworkIpc.getUptime().catch(e => null),
    getCommitId().catch(e => null)
  ]);

  res.json({
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
    },
    managerContract: {
      network: collateralInfo?.contract?.network,
      address: collateralInfo?.contract?.address,
    },
    shield:{
      enable: !!shieldForwardUrl,
      apps: shieldedApps
    },
    addedToNetwork: !!nodeInfo,
    network: {
      nodeInfo: nodeInfo ? lodash.omit(nodeInfo || {}, ['peerId', 'wallet', 'staker']) : undefined,
      address: multiAddress,
    }
  })
}))

export default router;
