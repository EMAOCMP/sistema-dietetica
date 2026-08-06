import { Router } from 'express';
import { getVentas, crearVenta } from './ventas.controller';
import { verificarToken } from '../../middlewares/auth.middleware';

const router = Router();

router.get('/', verificarToken, getVentas);
router.post('/', verificarToken, crearVenta);

export default router;