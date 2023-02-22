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
  let collateralInfo = await NetworkIpc.getCollateralInfo()
  const nodeInfo = await NetworkIpc.getCurrentNodeInfo()
  const address = await NetworkIpc.getNodeMultiAddress()
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
      uptime: await NetworkIpc.getUptime(),
      commit: await getCommitId(),
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
      address,
    }
  })
}))

export default router;
