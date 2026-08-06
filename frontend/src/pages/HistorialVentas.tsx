import { useState, useEffect } from 'react';
import axios from 'axios';
import Layout from '../components/Layout';
// Sumamos el ícono de Descarga
import { BarChart3, Download } from 'lucide-react'; 
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
// Importamos la herramienta de Excel
import * as XLSX from 'xlsx';

interface Venta { id: number; usuario_id: number; total: string; fecha: string; }

export default function HistorialVentas() {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargarVentas = async () => {
    try {
      const token = localStorage.getItem('token');
      const respuesta = await axios.get('https://dietetica-backend-pkmn.onrender.com/api/ventas', { headers: { Authorization: `Bearer ${token}` } });
      setVentas(respuesta.data);
      setCargando(false);
    } catch (err) { console.error(err); setCargando(false); }
  };

  useEffect(() => { cargarVentas(); }, []);

  const formatearNumero = (numero: string | number) => Number(numero).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatearFecha = (fechaISO: string) => new Date(fechaISO).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const totalRecaudado = ventas.reduce((suma, venta) => suma + Number(venta.total), 0);
  const totalTickets = ventas.length;
  const promedioTicket = totalTickets > 0 ? totalRecaudado / totalTickets : 0;

  const datosGrafico = ventas.reduce((acumulador: any[], venta) => {
    const dia = new Date(venta.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    const diaExistente = acumulador.find(item => item.fecha === dia);
    if (diaExistente) {
      diaExistente.total += Number(venta.total); 
    } else {
      acumulador.push({ fecha: dia, total: Number(venta.total) }); 
    }
    return acumulador;
  }, []).reverse(); 

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ backgroundColor: '#0f1423', padding: '15px', border: '1px solid #1e2538', borderRadius: '8px', color: 'white' }}>
          <p style={{ margin: '0 0 5px 0', color: '#8b949e', fontSize: '12px' }}>{label}</p>
          <p style={{ margin: 0, fontWeight: 'bold', color: '#3b82f6', fontSize: '18px' }}>
            ${formatearNumero(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  // --- LÓGICA PARA EXPORTAR A EXCEL ---
  const exportarExcel = () => {
    if (ventas.length === 0) {
      alert("No hay ventas para exportar.");
      return;
    }

    // 1. Preparamos los datos limpios y en español para el Excel
    const datosParaExcel = ventas.map(venta => ({
      'N° de Ticket': `TKT-${venta.id.toString().padStart(5, '0')}`,
      'Fecha y Hora': formatearFecha(venta.fecha),
      'Estado': 'Completado',
      'Total Vendido ($)': Number(venta.total)
    }));

    // 2. Creamos la hoja de cálculo
    const hoja = XLSX.utils.json_to_sheet(datosParaExcel);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Reporte de Ventas");

    // 3. Descargamos el archivo en la compu
    XLSX.writeFile(libro, "Historial_Ventas_Dietetica.xlsx");
  };

  const WidgetMentX = ({ titulo, valor, etiqueta, colorEtiqueta }: any) => (
    <div style={{ backgroundColor: '#13192b', padding: '25px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '15px', flex: 1, border: '1px solid #1e2538' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: '15px', fontWeight: '500' }}>{titulo}</span>
        <span style={{ color: colorEtiqueta, backgroundColor: `${colorEtiqueta}20`, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>{etiqueta}</span>
      </div>
      <h3 style={{ margin: 0, color: '#ffffff', fontSize: '32px', fontWeight: 'bold' }}>{valor}</h3>
    </div>
  );

  return (
    <Layout>
      {/* HEADER CON BOTÓN DE EXPORTAR */}
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <BarChart3 size={32} color="#ffffff" />
          <div>
            <h1 style={{ margin: 0, color: '#ffffff', fontSize: '28px' }}>Sales History</h1>
            <p style={{ margin: '5px 0 0 0', color: '#8b949e' }}>Reportes y finanzas de tu negocio.</p>
          </div>
        </div>
        
        {/* BOTÓN MÁGICO DE EXCEL */}
        <button onClick={exportarExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '15px', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)' }}>
          <Download size={20} /> Exportar a Excel
        </button>
      </div>

      <div className="widgets-container" style={{ display: 'flex', gap: '25px', marginBottom: '30px' }}>
        <WidgetMentX titulo="Total Revenue" valor={`$${formatearNumero(totalRecaudado)}`} etiqueta="~ Ingresos" colorEtiqueta="#10b981" />
        <WidgetMentX titulo="Total Orders" valor={totalTickets} etiqueta="~ Tickets" colorEtiqueta="#3b82f6" />
        <WidgetMentX titulo="Average Value" valor={`$${formatearNumero(promedioTicket)}`} etiqueta="~ Promedio" colorEtiqueta="#a855f7" />
      </div>

      <div style={{ backgroundColor: '#13192b', borderRadius: '16px', border: '1px solid #1e2538', padding: '25px', marginBottom: '30px', height: '350px' }}>
        <h3 style={{ margin: '0 0 20px 0', color: '#ffffff', fontSize: '18px' }}>Revenue Overview</h3>
        {cargando ? (
           <p style={{ color: '#8b949e' }}>Cargando gráfico...</p>
        ) : datosGrafico.length === 0 ? (
           <p style={{ color: '#8b949e', textAlign: 'center', marginTop: '50px' }}>No hay datos suficientes para graficar.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={datosGrafico} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2538" vertical={false} />
              <XAxis dataKey="fecha" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="table-container" style={{ backgroundColor: '#13192b', borderRadius: '16px', border: '1px solid #1e2538', padding: '25px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
           <h3 style={{ margin: 0, color: '#ffffff', fontSize: '18px' }}>Recent Transactions</h3>
        </div>
        
        {cargando ? <p style={{ color: '#8b949e' }}>Cargando ventas...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #1e2538' }}>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Ticket ID</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Date & Time</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '15px 10px', color: '#8b949e', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: '#8b949e' }}>No hay ventas registradas todavía.</td></tr>
              ) : (
                ventas.map((venta) => (
                  <tr key={venta.id} style={{ borderBottom: '1px solid #1e2538' }}>
                    <td style={{ padding: '15px 10px' }}>
                      <div style={{ backgroundColor: '#1e2538', padding: '8px 12px', borderRadius: '8px', color: '#8b949e', fontSize: '13px', display: 'inline-block', fontWeight: 'bold' }}>
                        TKT-{venta.id.toString().padStart(5, '0')}
                      </div>
                    </td>
                    <td style={{ padding: '15px 10px', color: '#ffffff', fontSize: '14px' }}>{formatearFecha(venta.fecha)}</td>
                    <td style={{ padding: '15px 10px' }}>
                      <span style={{ color: '#10b981', fontWeight: 'bold', backgroundColor: '#10b98120', padding: '5px 10px', borderRadius: '6px', fontSize: '12px' }}>Completed</span>
                    </td>
                    <td style={{ padding: '15px 10px', color: '#10b981', fontWeight: 'bold', fontSize: '16px', textAlign: 'right' }}>
                      ${formatearNumero(venta.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}