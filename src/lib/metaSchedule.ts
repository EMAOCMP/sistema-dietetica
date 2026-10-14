export const META_DEFAULT_OPEN = '08:00';
export const META_DEFAULT_CLOSE = '21:00';

const OPEN_KEY = 'dv-meta-open';
const CLOSE_KEY = 'dv-meta-close';

export function hoursOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h + min / 60;
}

export function isValidTime(hhmm: string): boolean {
  return !Number.isNaN(hoursOf(hhmm));
}

export function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

export function loadMetaSchedule(): { open: string; close: string } {
  try {
    const open = localStorage.getItem(OPEN_KEY) || META_DEFAULT_OPEN;
    const close = localStorage.getItem(CLOSE_KEY) || META_DEFAULT_CLOSE;
    return {
      open: isValidTime(open) ? open : META_DEFAULT_OPEN,
      close: isValidTime(close) ? close : META_DEFAULT_CLOSE,
    };
  } catch {
    return { open: META_DEFAULT_OPEN, close: META_DEFAULT_CLOSE };
  }
}

export function saveMetaSchedule(open: string, close: string): boolean {
  try {
    localStorage.setItem(OPEN_KEY, open);
    localStorage.setItem(CLOSE_KEY, close);
    return true;
  } catch {
    return false;
  }
}
