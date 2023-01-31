import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import lodash from 'lodash'

const NodeAddress = process.env.SIGN_WALLET_ADDRESS || null;
const PeerID = process.env.PEER_ID || null
const shieldForwardUrl = process.env.SHIELD_FORWARD_URL || null
const shieldedApps = (process.env.SHIELDED_APPS || "").split('|').filter(v => !!v)

const router = Router();

router.use('/', async (req, res, next) => {
  let collateralInfo = await NetworkIpc.getCollateralInfo()
  const nodeInfo = await NetworkIpc.getCurrentNodeInfo()
  res.json({
    staker: nodeInfo ? nodeInfo.staker : undefined,
    address: NodeAddress,
    peerId: PeerID,
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
      nodeInfo: {
        ...lodash.omit(nodeInfo || {}, ['peerId', 'wallet', 'staker']),
        isOnline: !!nodeInfo,
      },
    }
  })
})

export default router;
