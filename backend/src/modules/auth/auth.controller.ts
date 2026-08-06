import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../../config/db';

export const login = async (req: Request, res: Response): Promise<any> => {
    try {
        const { email, password } = req.body;

        // 🕵️‍♂️ LOG DETECTIVE 1: ¿Qué datos están llegando al servidor?
        console.log('--- INICIO DE PRUEBA DE LOGIN ---');
        console.log('1. Email recibido desde Thunder Client:', email);
        console.log('2. Password recibida desde Thunder Client:', password);

        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        
        // 🕵️‍♂️ LOG DETECTIVE 2: ¿Encontró al usuario en la base de datos?
        console.log('3. ¿Usuario encontrado en la BD?:', result.rows.length > 0 ? 'SÍ' : 'NO');

        if (result.rows.length === 0) {
            console.log('❌ Error: El usuario no existe en la BD.');
            return res.status(401).json({ mensaje: 'Email o contraseña incorrectos' });
        }

        const usuario = result.rows[0];

        if (!usuario.activo) {
            return res.status(403).json({ mensaje: 'Usuario suspendido.' });
        }

        // 🕵️‍♂️ LOG DETECTIVE 3: Comparamos las contraseñas
        console.log('4. Hash guardado en BD:', usuario.password_hash);
        const passwordValida = await bcrypt.compare(password, usuario.password_hash);
        console.log('5. ¿Las contraseñas coinciden?:', passwordValida);

        if (!passwordValida) {
            console.log('❌ Error: Las contraseñas NO coinciden.');
            return res.status(401).json({ mensaje: 'Email o contraseña incorrectos' });
        }

        const token = jwt.sign(
            { id: usuario.id, rol_id: usuario.rol_id, sucursal_id: usuario.sucursal_id },
            process.env.JWT_SECRET as string,
            { expiresIn: '8h' }
        );

        console.log('6. ✅ ¡Todo correcto! Generando token y dando acceso...');
        
        res.json({
            mensaje: '¡Login exitoso!',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol_id: usuario.rol_id
            }
        });

    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor' });
    }
};