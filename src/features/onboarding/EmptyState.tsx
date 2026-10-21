import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Estado vacío interactivo (Empty States interactivos).
 * Ilustración + explicación + CTA para guiar al usuario cuando no hay datos.
 */
export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="glass-card rounded-3xl p-8 sm:p-10 text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-brand-500/10 dark:bg-brand-500/15 flex items-center justify-center mx-auto mb-4 text-brand-500 dark:text-brand-400">
        {icon}
      </div>
      <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-500/25 transition active:scale-95 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}