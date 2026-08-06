import { Request, Response } from 'express';
import pool from '../../config/db';

export const getVentas = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM ventas ORDER BY fecha DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener ventas:', error);
        res.status(500).json({ mensaje: 'Error al cargar el historial' });
    }
};

export const crearVenta = async (req: Request, res: Response): Promise<any> => {
    const cliente = await pool.connect();
    
    try {
        const { usuario_id, total, detalles } = req.body;
        
        await cliente.query('BEGIN');

        const ventaResult = await cliente.query(
            'INSERT INTO ventas (usuario_id, total) VALUES ($1, $2) RETURNING id',
            [usuario_id, total]
        );
        const ventaId = ventaResult.rows[0].id;

        for (const item of detalles) {
            await cliente.query(
                `INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ventaId, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
            );
            await cliente.query(
                `UPDATE productos SET stock = stock - $1 WHERE id = $2`,
                [item.cantidad, item.producto_id]
            );
        }

        await cliente.query('COMMIT');
        res.status(201).json({ mensaje: '¡Venta registrada con éxito!', venta_id: ventaId });

    } catch (error) {
        await cliente.query('ROLLBACK');
        console.error('Error al registrar venta:', error);
        res.status(500).json({ mensaje: 'Error al procesar el cobro' });
    } finally {
        cliente.release();
    }
};