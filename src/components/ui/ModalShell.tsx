import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalShellProps {
  onClose: () => void;
  icon: ReactNode;
  title: string;
  maxWidth?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
}

export function ModalShell({ onClose, icon, title, maxWidth = 'max-w-xl', footer, headerActions, children }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="bg-black/60 backdrop-blur-sm"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div style={{ minHeight: '100%', display: 'flex', padding: 16 }}>
        <div
          className={`relative bg-white dark:bg-[#1F1F1F] rounded-3xl ${maxWidth} p-4 sm:p-6 space-y-4 sm:space-y-6 shadow-2xl border border-transparent dark:border-[#333333]`}
          style={{ margin: 'auto', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center border-b dark:border-[#333333] pb-4 shrink-0">
            <div className="flex items-center space-x-2 min-w-0">
              {icon}
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">{title}</h2>
            </div>
          {headerActions}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition"
            aria-label="Cerrar"
          >
            <X size={24} />
          </button>
          </div>

          <div className="pr-1 custom-scrollbar" style={{ overflowY: 'auto', minHeight: 0, flex: '1 1 auto' }}>{children}</div>

          <div className="flex justify-end pt-2 border-t dark:border-[#333333] shrink-0">
            {footer ?? (
              <button
                onClick={onClose}
                className="px-6 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 text-white rounded-xl text-sm font-bold shadow cursor-pointer transition"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
