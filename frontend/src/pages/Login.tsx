import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mensaje, setMensaje] = useState('');
  
  // Herramienta de React Router para viajar entre páginas
  const navigate = useNavigate(); 

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje('⏳ Comprobando credenciales...');
    
    try {
      const respuesta = await axios.post('https://dietetica-backend-pkmn.onrender.com/api/auth/login', {
        email,
        password
      });
      
      // 1. GUARDAMOS EL TOKEN Y EL NOMBRE EN LA MEMORIA DEL NAVEGADOR
      localStorage.setItem('token', respuesta.data.token);
      localStorage.setItem('usuarioNombre', respuesta.data.usuario.nombre);

      setMensaje('✅ ¡Login exitoso! Entrando al sistema...');
      
      // 2. VIAJAMOS AL DASHBOARD (Esperamos medio segundo para que se vea el mensaje verde)
      setTimeout(() => {
        navigate('/dashboard');
      }, 500);
      
    } catch (error: any) {
      setMensaje('❌ Error: ' + (error.response?.data?.mensaje || 'Error de conexión'));
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f4f4f9' }}>
      <div style={{ padding: '40px', backgroundColor: 'white', borderRadius: '10px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', width: '350px' }}>
        <h2 style={{ textAlign: 'center', color: '#333', marginBottom: '20px' }}>🍏 Dietética Login</h2>
        
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input
            type="email" placeholder="Tu email" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ padding: '12px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '16px' }}
          />
          <input
            type="password" placeholder="Tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ padding: '12px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '16px' }}
          />
          <button type="submit" style={{ padding: '12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' }}>
            Iniciar Sesión
          </button>
        </form>

        {mensaje && (
          <div style={{ marginTop: '20px', padding: '10px', textAlign: 'center', borderRadius: '5px', backgroundColor: mensaje.includes('✅') ? '#d4edda' : '#f8d7da', color: mensaje.includes('✅') ? '#155724' : '#721c24' }}>
            {mensaje}
          </div>
        )}
      </div>
    </div>
  );
}