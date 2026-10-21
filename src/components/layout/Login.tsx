import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Lock, Mail, User } from 'lucide-react';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName || 'Administrador',
            },
          },
        });
        if (signUpError) throw signUpError;

        alert('¡Cuenta creada con éxito! Ya puedes iniciar sesión.');
        setIsSignUp(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error en la autenticación');
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 focus:outline-none text-slate-900 text-sm shadow-sm placeholder-slate-400 dark:bg-obsidian-900 dark:border-obsidian-600 dark:text-white dark:placeholder-zinc-600';

  return (
    <div
      className="min-h-screen bg-cover bg-center relative flex items-center justify-center p-4"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=1920&q=80')`,
      }}
    >
      <div className="absolute inset-0 bg-white/75 backdrop-blur-sm dark:bg-obsidian-950/85"></div>

      <div className="relative z-10 max-w-md w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-200/80 ring-1 ring-brand-500/20 overflow-hidden p-6 sm:p-8 dark:bg-obsidian-800/60 dark:border-white/10">
        <div className="text-center mb-6 sm:mb-8">
          <img src="/logo-512.jpg" alt="Vishal Dietética" className="h-16 mx-auto mb-3 object-contain" />
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight dark:text-white">Dietética Vishal</h1>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mt-1 dark:text-zinc-400">Control de Stock y Ventas</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-medium dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 dark:text-zinc-400">Nombre Completo</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 dark:text-zinc-400">
                  <User size={18} />
                </span>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputCls}
                  placeholder="Juan Pérez"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 dark:text-zinc-400">Correo Electrónico</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 dark:text-zinc-400">
                <Mail size={18} />
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="admin@dietetica.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 dark:text-zinc-400">Contraseña</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 dark:text-zinc-400">
                <Lock size={18} />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-glow-brand transition duration-200 disabled:opacity-50 text-base cursor-pointer"
          >
            {loading ? 'Procesando...' : isSignUp ? 'Registrar Cuenta' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm text-brand-600 hover:text-brand-700 hover:underline font-bold transition cursor-pointer dark:text-brand-400 dark:hover:text-brand-300"
          >
            {isSignUp ? '¿Ya tenés cuenta? Inicia sesión' : '¿Primer usuario? Crea tu cuenta de Administrador'}
          </button>
        </div>
      </div>
    </div>
  );
}