import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react'; // <-- Agregamos la palabra 'type' acá

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('token');
  
  if (!token) {
    return <Navigate to="/" />;
  }
  
  return children;
}