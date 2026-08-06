import { Pool } from 'pg';
import dotenv from 'dotenv';

// Cargamos las variables secretas del archivo .env
dotenv.config();

// Creamos el "Pool" de conexiones usando los datos de tu .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Esto es obligatorio para conectarse a Neon
  }
});

// Mensaje para avisarnos en la consola cuando se conecte bien
pool.on('connect', () => {
  console.log('📦 Conectado exitosamente a la base de datos PostgreSQL de la Dietética');
});

// Captura de errores por si se corta la conexión
pool.on('error', (err) => {
  console.error('❌ Error inesperado en la base de datos:', err);
  process.exit(-1);
});

export default pool;