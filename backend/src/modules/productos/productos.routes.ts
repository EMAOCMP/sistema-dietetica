import { Router } from 'express';
import { getProductos, crearProducto, actualizarProducto, eliminarProducto } from './productos.controller';
import { verificarToken } from '../../middlewares/auth.middleware';

const router = Router();

router.get('/', verificarToken, getProductos);
router.post('/', verificarToken, crearProducto);
router.put('/:id', verificarToken, actualizarProducto);
router.delete('/:id', verificarToken, eliminarProducto);

export default router;