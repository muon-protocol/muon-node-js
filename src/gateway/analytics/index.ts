import {Router} from 'express';
import crashRoutes from './crash.js'
import insufficientRoutes from './insufficient.js'
import confirmFailure from './confirm-failure.js'

const router = Router();

router.use("/crash", crashRoutes);
router.use("/insufficient", insufficientRoutes);
router.use("/confirm", confirmFailure);

export default router;
