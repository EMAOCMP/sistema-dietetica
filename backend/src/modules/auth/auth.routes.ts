import { Router } from 'express';
import { login } from './auth.controller';

const router = Router();

// Cuando alguien envíe datos por POST a /login, se ejecuta la función de nuestro controlador
router.post('/login', login);

export default router;