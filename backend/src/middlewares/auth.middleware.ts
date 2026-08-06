import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Le avisamos a TypeScript que a partir de ahora, las peticiones pueden traer los datos del usuario
export interface AuthRequest extends Request {
    usuario?: any;
}

export const verificarToken = (req: AuthRequest, res: Response, next: NextFunction): any => {
    try {
        // 1. Buscamos la "credencial" en la cabecera de la petición
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(403).json({ mensaje: 'Acceso denegado. Falta el token de seguridad.' });
        }

        // 2. Extraemos el token (le sacamos la palabra "Bearer ")
        const token = authHeader.split(' ')[1];

        // 3. Verificamos que sea válido y no esté falsificado usando nuestra clave secreta del .env
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

        // 4. Si el token es real, guardamos los datos del usuario y lo dejamos pasar a la app (next)
        req.usuario = decoded;
        next();

    } catch (error) {
        return res.status(401).json({ mensaje: 'Token inválido o sesión expirada. Vuelva a ingresar.' });
    }
};