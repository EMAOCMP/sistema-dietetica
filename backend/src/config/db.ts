import { Pool } from 'pg';
import dotenv from 'dotenv';

// Cargamos las variables secretas del archivo .env
dotenv.config();

// Creamos el "Pool" de conexiones usando los datos de tu .env
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
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