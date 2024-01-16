import {Router} from 'express';
import crashRoutes from './crash.js'
import insufficientRoutes from './insufficient.js'

const router = Router();

router.use("/crash", crashRoutes);
router.use("/insufficient", insufficientRoutes);

export default router;
