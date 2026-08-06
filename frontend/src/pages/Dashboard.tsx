import { useState, useEffect } from 'react';
import axios from 'axios';
import Layout from '../components/Layout';
import { Plus, Edit2, Trash2 } from 'lucide-react'; 

interface Producto { id: number; nombre: string; descripcion: string; categoria: string; precio: string; stock: string; unidad_medida: string; }

export default function Dashboard() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  
  const [mostrarModal, setMostrarModal] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false); 
  const [productoForm, setProductoForm] = useState({ id: 0, nombre: '', descripcion: '', categoria: '', precio: '', stock: '', unidad_medida: 'unidades' });

  const cargarProductos = async () => {
    try {
      const token = localStorage.getItem('token');
      const respuesta = await axios.get('https://dietetica-backend-pkmn.onrender.com/api/productos', { headers: { Authorization: `Bearer ${token}` } });
      setProductos(respuesta.data);
      setCargando(false);
    } catch (err) { console.error(err); setCargando(false); }
  };

  useEffect(() => { cargarProductos(); }, []);

  const abrirModalNuevo = () => {
    setModoEdicion(false);
    setProductoForm({ id: 0, nombre: '', descripcion: '', categoria: '', precio: '', stock: '', unidad_medida: 'unidades' });
    setMostrarModal(true);
  };

  const abrirModalEditar = (prod: Producto) => {
    setModoEdicion(true);
    setProductoForm({ id: prod.id, nombre: prod.nombre, descripcion: prod.descripcion, categoria: prod.categoria, precio: prod.precio, stock: prod.stock, unidad_medida: prod.unidad_medida });
    setMostrarModal(true);
  };

  const handleGuardarProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      if (modoEdicion) {
        await axios.put(`https://dietetica-backend-pkmn.onrender.com/api/productos/${productoForm.id}`, productoForm, config);
      } else {
        await axios.post('https://dietetica-backend-pkmn.onrender.com/api/productos', productoForm, config);
      }
      setMostrarModal(false);
      cargarProductos();
    } catch (err) { alert("Error al guardar"); }
  };

  const handleEliminarProducto = async (id: number, nombre: string) => {
    const confirmar = window.confirm(`¿Estás seguro que querés eliminar "${nombre}"?`);
    if (!confirmar) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`https://dietetica-backend-pkmn.onrender.com/api/productos/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      cargarProductos(); 
    } catch (err) { alert("Error al eliminar el producto"); }
  };

  const formatearNumero = (numero: string | number) => Number(numero).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalProductos = productos.length;
  const valorInventario = productos.reduce((total, p) => total + (Number(p.precio) * Number(p.stock)), 0);
  const productosBajoStock = productos.filter(p => Number(p.stock) < 5).length;

  const WidgetMentX = ({ titulo, valor, etiqueta, colorEtiqueta }: any) => (
    <div style={{ backgroundColor: '#13192b', padding: '25px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '15px', flex: 1, border: '1px solid #1e2538' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: '15px', fontWeight: '500' }}>{titulo}</span>
        <span style={{ color: colorEtiqueta, backgroundColor: `${colorEtiqueta}20`, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>{etiqueta}</span>
      </div>
      <h3 style={{ margin: 0, color: '#ffffff', fontSize: '32px', fontWeight: 'bold' }}>{valor}</h3>
      <div style={{ height: '40px', width: '100%', marginTop: '10px', display: 'flex', alignItems: 'flex-end', gap: '4px' }}>
         {[40, 70, 45, 90, 60, 100, 80].map((h, i) => <div key={i} style={{ width: '12%', height: `${h}%`, backgroundColor: i % 2 === 0 ? colorEtiqueta : `${colorEtiqueta}50`, borderRadius: '4px' }}></div>)}
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: '#ffffff', fontSize: '24px' }}>Overview</h1>
        <button onClick={abrirModalNuevo} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '15px' }}>
          <Plus size={20} /> Add Product
        </button>
      </div>

      <div className="widgets-container" style={{ display: 'flex', gap: '25px', marginBottom: '30px' }}>
        <WidgetMentX titulo="Total Products" valor={totalProductos} etiqueta="~ Active" colorEtiqueta="#10b981" />
        <WidgetMentX titulo="Inventory Value" valor={`$${formatearNumero(valorInventario)}`} etiqueta="~ Capital" colorEtiqueta="#3b82f6" />
        <WidgetMentX titulo="Low Stock Alerts" valor={productosBajoStock} etiqueta="~ Warning" colorEtiqueta="#ef4444" />
      </div>

      <div className="table-container" style={{ backgroundColor: '#13192b', borderRadius: '16px', border: '1px solid #1e2538', padding: '25px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
           <h3 style={{ margin: 0, color: '#ffffff', fontSize: '18px' }}>Recent Inventory</h3>
        </div>
        
        {cargando ? <p style={{ color: '#8b949e' }}>Loading data...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #1e2538' }}>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Product ID & Name</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Category</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Price</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Stock</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((prod) => (
                <tr key={prod.id} style={{ borderBottom: '1px solid #1e2538' }}>
                  <td style={{ padding: '15px 10px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ backgroundColor: '#1e2538', padding: '10px', borderRadius: '8px', color: '#8b949e', fontSize: '12px' }}>#{prod.id}</div>
                    <div>
                      <strong style={{ color: '#ffffff', fontSize: '14px' }}>{prod.nombre}</strong> <br/>
                      <small style={{ color: '#8b949e' }}>{prod.descripcion}</small>
                    </div>
                  </td>
                  <td style={{ padding: '15px 10px', color: '#8b949e', fontSize: '14px' }}>{prod.categoria}</td>
                  <td style={{ padding: '15px 10px', color: '#ffffff', fontWeight: 'bold' }}>${formatearNumero(prod.precio)}</td>
                  <td style={{ padding: '15px 10px' }}>
                    <span style={{ color: Number(prod.stock) < 5 ? '#ef4444' : '#10b981', fontWeight: 'bold', backgroundColor: Number(prod.stock) < 5 ? '#ef444420' : '#10b98120', padding: '5px 10px', borderRadius: '6px' }}>
                      {formatearNumero(prod.stock)} {prod.unidad_medida}
                    </span>
                  </td>
                  <td style={{ padding: '15px 10px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button onClick={() => abrirModalEditar(prod)} style={{ backgroundColor: '#3b82f620', color: '#3b82f6', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer' }} title="Editar">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleEliminarProducto(prod.id, prod.nombre)} style={{ backgroundColor: '#ef444420', color: '#ef4444', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer' }} title="Eliminar">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mostrarModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
          <div className="modal-content" style={{ backgroundColor: '#13192b', padding: '30px', borderRadius: '16px', width: '450px', border: '1px solid #1e2538', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#ffffff', fontSize: '20px' }}>
              {modoEdicion ? 'Edit Product' : 'Add New Product'}
            </h3>
            <form onSubmit={handleGuardarProducto} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="text" placeholder="Name" required value={productoForm.nombre} onChange={(e) => setProductoForm({...productoForm, nombre: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none' }} />
              <input type="text" placeholder="Description" required value={productoForm.descripcion} onChange={(e) => setProductoForm({...productoForm, descripcion: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none' }} />
              <input type="text" placeholder="Category" required value={productoForm.categoria} onChange={(e) => setProductoForm({...productoForm, categoria: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none' }} />
              <div className="modal-row" style={{ display: 'flex', gap: '15px' }}>
                <input type="number" step="0.01" placeholder="Price ($)" required value={productoForm.precio} onChange={(e) => setProductoForm({...productoForm, precio: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none', width: '50%' }} />
                <input type="number" step="0.01" placeholder="Stock" required value={productoForm.stock} onChange={(e) => setProductoForm({...productoForm, stock: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none', width: '50%' }} />
              </div>
              <select value={productoForm.unidad_medida} onChange={(e) => setProductoForm({...productoForm, unidad_medida: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #1e2538', backgroundColor: '#0b101e', color: 'white', outline: 'none' }}>
                <option value="kg">Kilograms (kg)</option><option value="gr">Grams (gr)</option><option value="unidades">Units (un)</option>
              </select>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '15px' }}>
                <button type="button" onClick={() => setMostrarModal(false)} style={{ padding: '10px 20px', backgroundColor: '#1e2538', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 20px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {modoEdicion ? 'Save Changes' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}