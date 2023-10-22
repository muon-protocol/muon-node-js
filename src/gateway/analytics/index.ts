import {Router} from 'express';
import crashRoutes from './crash.js'
import insufficientRoutes from './insufficient.js'
import confirmFailure from './confirm-failure.js'
import reshareFailure from './reshare-failure.js'
import partialSign from './partial-sign.js'

const router = Router();

router.use("/crash", crashRoutes);
router.use("/insufficient", insufficientRoutes);
router.use("/confirm", confirmFailure);
router.use("/reshare", reshareFailure);
router.use("/partial", partialSign);

export default router;
