import bcrypt from 'bcrypt';
import pool from './src/config/db';
import dotenv from 'dotenv';

// 👇 ESTA ES LA LÍNEA MÁGICA QUE ME HABÍA OLVIDADO 👇
dotenv.config(); 

const repararContrasena = async () => {
    try {
        console.log('⏳ Conectando a la base de datos...');
        
        // 1. Encriptamos la clave correcta
        const nuevoHash = await bcrypt.hash('Admin123!', 10);
        
        // 2. Buscamos al administrador y le actualizamos la contraseña
        await pool.query("UPDATE usuarios SET password_hash = $1 WHERE email = 'admin@dietetica.com'", [nuevoHash]);
        
        console.log('✅ ¡Contraseña reparada con éxito en la base de datos!');
        console.log('🔑 Tu clave oficial ahora es: Admin123!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error reparando la base de datos:', error);
        process.exit(1);
    }
};

repararContrasena();