import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './modules/auth/auth.routes'; 
import productosRoutes from './modules/productos/productos.routes';
import ventasRoutes from './modules/ventas/ventas.routes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rutas de la API
app.use('/api/auth', authRoutes); 
app.use('/api/productos', productosRoutes); 
app.use('/api/ventas', ventasRoutes);

app.get('/api/health', async (req: Request, res: Response) => {
    res.json({ estado: 'Servidor 100% Saludable y Operativo 🚀' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🔍 Probá la conexión entrando a http://localhost:${PORT}/api/health`);
});