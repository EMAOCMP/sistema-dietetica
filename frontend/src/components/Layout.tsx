import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, LogOut, User, Package, Bell, Search, BarChart3 } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nombreUsuario = localStorage.getItem('usuarioNombre') || 'Administrador';

  const handleCerrarSesion = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuarioNombre');
    navigate('/');
  };

  const MenuButton = ({ ruta, texto, icono }: { ruta: string, texto: string, icono: ReactNode }) => {
    const activo = location.pathname === ruta;
    return (
      <button 
        className="sidebar-btn"
        onClick={() => navigate(ruta)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 20px', 
          backgroundColor: activo ? '#3b82f6' : 'transparent', 
          color: activo ? '#ffffff' : '#8b949e',
          border: 'none', borderRadius: '12px', 
          cursor: 'pointer', fontSize: '15px', fontWeight: activo ? '600' : '500', textAlign: 'left',
          transition: 'all 0.2s', marginBottom: '8px'
        }}
      >
        {icono} {texto}
      </button>
    );
  };

  return (
    <div className="layout-container" style={{ display: 'flex', height: '100vh', backgroundColor: '#0b101e', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="sidebar" style={{ width: '260px', backgroundColor: '#0f1423', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e2538', zIndex: 10 }}>
        <div className="sidebar-logo" style={{ padding: '30px 25px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#e2e8f0', padding: '6px', borderRadius: '8px', display: 'flex' }}>
            <Package color="#0f1423" size={24} />
          </div>
          <h2 style={{ color: 'white', margin: 0, fontSize: '22px', letterSpacing: '0.5px' }}>Dietética <span style={{color: '#3b82f6'}}>X</span></h2>
        </div>

        <div className="sidebar-nav-container" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="sidebar-section" style={{ padding: '10px 20px' }}>
            <p className="sidebar-titles" style={{ color: '#4b5563', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '15px', paddingLeft: '10px' }}>Menu</p>
            <MenuButton ruta="/dashboard" texto="Dashboard" icono={<LayoutDashboard size={20} />} />
            <MenuButton ruta="/caja" texto="Punto de Venta" icono={<ShoppingCart size={20} />} />
            <MenuButton ruta="/historial" texto="Sales History" icono={<BarChart3 size={20} />} />
          </div>

          <div className="sidebar-section" style={{ padding: '20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="sidebar-titles" style={{ color: '#4b5563', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '15px', paddingLeft: '10px' }}>Otros</p>
            <button className="sidebar-btn" onClick={handleCerrarSesion} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', backgroundColor: 'transparent', color: '#8b949e', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'all 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
              <LogOut size={20} /> Cerrar Sesión
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar" style={{ height: '80px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 40px', borderBottom: '1px solid #1e2538' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
             <p style={{ color: '#8b949e', margin: 0, fontSize: '14px' }}>Hello!<br/><strong style={{color: 'white', fontSize: '16px'}}>System Admin</strong></p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Search color="#8b949e" size={20} style={{cursor: 'pointer'}} />
            <Bell color="#8b949e" size={20} style={{cursor: 'pointer'}} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '15px', borderLeft: '1px solid #1e2538' }}>
              <div style={{ backgroundColor: '#3b82f6', borderRadius: '50%', padding: '8px' }}><User size={18} color="white" /></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: 'white', fontWeight: '600', fontSize: '14px' }}>{nombreUsuario}</span>
                <span style={{ color: '#8b949e', fontSize: '12px' }}>Admin</span>
              </div>
            </div>
          </div>
        </div>

        <div className="main-content" style={{ flex: 1, padding: '35px 40px', overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}