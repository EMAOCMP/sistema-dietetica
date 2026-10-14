import { supabase } from './supabase';

export function getPuntoVenta(): string {
  try {
    return (localStorage.getItem('dv-punto-venta') || '0001').padStart(4, '0').slice(-4);
  } catch {
    return '0001';
  }
}

export const formatReceipt = (n: number) =>
  `${getPuntoVenta()}-${String(n).padStart(8, '0')}`;

/**
 * Reserva el próximo número correlativo con compare-and-swap.
 * Devuelve null si la tabla sale_counters no existe (el SQL
 * pendiente) para no bloquear la venta: el ticket usa el # interno.
 */
export async function nextReceiptNumber(): Promise<string | null> {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row, error: selError } = await supabase
        .from('sale_counters')
        .select('last_number')
        .eq('id', 1)
        .maybeSingle();
      if (selError) throw selError;

      if (!row) {
        const { error: insError } = await supabase
          .from('sale_counters')
          .insert({ id: 1, last_number: 0 });
        if (insError) throw insError;
        continue;
      }

      const candidate = Number(row.last_number) + 1;
      const { data: updated, error: updError } = await supabase
        .from('sale_counters')
        .update({ last_number: candidate })
        .eq('id', 1)
        .eq('last_number', row.last_number)
        .select('last_number');
      if (updError) throw updError;
      if (updated && updated.length > 0) return formatReceipt(candidate);
      // otro cobro ganó la carrera: reintentar
    }
    return null;
  } catch {
    return null;
  }
}
