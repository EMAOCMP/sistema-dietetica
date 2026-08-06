import { Request, Response } from 'express';
import pool from '../../config/db';

export const getProductos = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM productos WHERE activo = true ORDER BY nombre ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al cargar productos' });
    }
};

export const crearProducto = async (req: Request, res: Response) => {
    try {
        const { nombre, descripcion, categoria, precio, stock, unidad_medida } = req.body;
        const result = await pool.query(
            `INSERT INTO productos (nombre, descripcion, categoria, precio, stock, unidad_medida) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre, descripcion, categoria, precio, stock, unidad_medida]
        );
        res.status(201).json({ mensaje: 'Creado con éxito', producto: result.rows[0] });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear producto' });
    }
};

export const actualizarProducto = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, categoria, precio, stock, unidad_medida } = req.body;

        const result = await pool.query(
            `UPDATE productos SET nombre = $1, descripcion = $2, categoria = $3, precio = $4, stock = $5, unidad_medida = $6 
             WHERE id = $7 RETURNING *`,
            [nombre, descripcion, categoria, precio, stock, unidad_medida, id]
        );

        res.json({ mensaje: 'Producto actualizado con éxito', producto: result.rows[0] });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar el producto' });
    }
};

export const eliminarProducto = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Borrado Lógico
        await pool.query('UPDATE productos SET activo = false WHERE id = $1', [id]);
        res.json({ mensaje: 'Producto eliminado correctamente' });
    } catch (error) {
        console.error("🚨 ERROR EN BASE DE DATOS:", error); // <-- PRENDEMOS LA LINTERNA
        res.status(500).json({ mensaje: 'Error al eliminar el producto' });
    }
};