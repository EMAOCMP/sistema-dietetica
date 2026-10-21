import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Lock, Key } from 'lucide-react';

export function NewPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error al actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl border-2 border-emerald-500 ring-4 ring-emerald-500/20 p-8 text-center">
          <div className="inline-flex p-3.5 bg-emerald-100 text-emerald-700 rounded-2xl mb-4 shadow-md">
            <Key size={36} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-2">¡Contraseña actualizada!</h1>
          <p className="text-slate-500 text-sm mb-6">Ya podés volver a usar la aplicación con tu nueva contraseña.</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition"
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-cover bg-center relative flex items-center justify-center p-4"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=1920&q=80')`,
      }}
    >
      <div className="absolute inset-0 bg-slate-950/60"></div>
      <div className="relative z-10 max-w-md w-full bg-white rounded-3xl shadow-2xl border-2 border-emerald-500 ring-4 ring-emerald-500/20 overflow-hidden p-8">
        <div className="text-center mb-8">
          <div className="inline-flex p-3.5 bg-emerald-100 text-emerald-700 rounded-2xl mb-4 shadow-md">
            <Lock size={36} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Nueva Contraseña</h1>
          <p className="text-slate-500 text-xs font-semibold text-center mt-1">Elegí una contraseña nueva para tu cuenta</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Nueva Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 text-sm shadow-sm"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Confirmar Contraseña</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 text-sm shadow-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition duration-200 disabled:opacity-50 text-base"
          >
            {loading ? 'Guardando...' : 'Actualizar Contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}