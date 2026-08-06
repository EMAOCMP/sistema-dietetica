import { useState, useEffect } from 'react';
import axios from 'axios';
import Layout from '../components/Layout';
import { ShoppingCart } from 'lucide-react';

interface Producto { id: number; nombre: string; precio: string; stock: string; unidad_medida: string; }
interface ItemCarrito { producto_id: number; nombre: string; cantidad: number; precio_unitario: number; subtotal: number; unidad_medida: string; }

export default function Caja() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState<string>('');
  const [cantidad, setCantidad] = useState<number | ''>('');

  const cargarProductos = async () => {
    try {
      const token = localStorage.getItem('token');
      const respuesta = await axios.get('http://localhost:3000/api/productos', { headers: { Authorization: `Bearer ${token}` } });
      setProductos(respuesta.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { cargarProductos(); }, []);

  const agregarAlCarrito = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoSeleccionado || !cantidad) return;
    const prod = productos.find(p => p.id === Number(productoSeleccionado));
    if (!prod) return;
    const precio = Number(prod.precio);
    const cant = Number(cantidad);
    const nuevoItem: ItemCarrito = { producto_id: prod.id, nombre: prod.nombre, cantidad: cant, precio_unitario: precio, subtotal: precio * cant, unidad_medida: prod.unidad_medida };
    setCarrito([...carrito, nuevoItem]);
    setProductoSeleccionado(''); setCantidad('');
  };

  const eliminarDelCarrito = (index: number) => { setCarrito(carrito.filter((_, i) => i !== index)); };
  const totalFactura = carrito.reduce((suma, item) => suma + item.subtotal, 0);

  const procesarVenta = async () => {
    if (carrito.length === 0) return alert("El carrito está vacío");
    try {
      const token = localStorage.getItem('token');
      await axios.post('http://localhost:3000/api/ventas', { usuario_id: 1, total: totalFactura, detalles: carrito }, { headers: { Authorization: `Bearer ${token}` } });
      alert("✅ ¡Venta registrada con éxito!");
      setCarrito([]); cargarProductos(); 
    } catch (err) { alert("❌ Error al procesar la venta."); }
  };

  const formatearNumero = (numero: number) => numero.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '25px' }}>
        <ShoppingCart size={32} color="#ffffff" />
        <div>
          <h1 style={{ margin: 0, color: '#ffffff', fontSize: '28px' }}>Punto de Venta</h1>
          <p style={{ margin: '5px 0 0 0', color: '#8b949e' }}>Armá el ticket y cobrá a tus clientes.</p>
        </div>
      </div>

      <div className="caja-container" style={{ display: 'flex', gap: '25px' }}>
        <div style={{ flex: 1, backgroundColor: '#13192b', padding: '25px', borderRadius: '16px', border: '1px solid #1e2538' }}>
          <h3 style={{ marginTop: 0, color: '#3b82f6', fontSize: '18px', borderBottom: '1px solid #1e2538', paddingBottom: '10px' }}>1. Seleccionar Producto</h3>
          <form onSubmit={agregarAlCarrito} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
            <select required value={productoSeleccionado} onChange={(e) => setProductoSeleccionado(e.target.value)} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none', fontSize: '15px' }}>
              <option value="">-- Elegir producto --</option>
              {productos.map(p => (
                <option key={p.id} value={p.id}>{p.nombre} - ${formatearNumero(Number(p.precio))} (Stock: {p.stock})</option>
              ))}
            </select>
            <input type="number" step="0.01" required placeholder="Cantidad" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none', fontSize: '15px' }} />
            <button type="submit" style={{ padding: '12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', transition: 'all 0.2s' }}>
              Agregar al Carrito ⬇️
            </button>
          </form>
        </div>

        <div style={{ flex: 1, backgroundColor: '#13192b', padding: '25px', borderRadius: '16px', border: '1px solid #1e2538' }}>
          <h3 style={{ marginTop: 0, color: '#ffffff', fontSize: '18px', borderBottom: '1px solid #1e2538', paddingBottom: '10px' }}>2. Ticket Actual</h3>
          <div className="table-container" style={{ minHeight: '180px', backgroundColor: '#0b101e', padding: '15px', borderRadius: '8px', marginBottom: '20px', marginTop: '20px', border: '1px solid #1e2538' }}>
            {carrito.length === 0 ? (
              <p style={{ color: '#8b949e', textAlign: 'center', marginTop: '60px' }}>El carrito está vacío</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '400px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e2538', textAlign: 'left' }}>
                    <th style={{ paddingBottom: '10px', color: '#8b949e', fontSize: '13px' }}>Producto</th>
                    <th style={{ paddingBottom: '10px', color: '#8b949e', fontSize: '13px' }}>Cant.</th>
                    <th style={{ paddingBottom: '10px', color: '#8b949e', fontSize: '13px' }}>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((item, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid #1e2538' }}>
                      <td style={{ padding: '12px 0', color: '#ffffff', fontWeight: '500' }}>{item.nombre}</td>
                      <td style={{ color: '#8b949e' }}>{item.cantidad} {item.unidad_medida}</td>
                      <td style={{ color: '#ffffff', fontWeight: 'bold' }}>${formatearNumero(item.subtotal)}</td>
                      <td><button onClick={() => eliminarDelCarrito(index)} style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', padding: '5px 10px', fontWeight: 'bold' }}>X</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0b101e', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #1e2538' }}>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#8b949e' }}>TOTAL:</span>
            <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>${formatearNumero(totalFactura)}</span>
          </div>
          <button onClick={procesarVenta} style={{ width: '100%', padding: '15px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}>
            💰 COBRAR TICKET
          </button>
        </div>
      </div>
    </Layout>
  );
}