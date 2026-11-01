import { format as fmt } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import i18n from './i18n';

export const dateLocale = () => (i18n.language === 'es' ? es : enUS);

export const formatDate = (d: Date | string, pattern: string) =>
  fmt(typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d, pattern, { locale: dateLocale() });

export function money(value: number, currency = 'MXN', opts: { sign?: boolean; compact?: boolean } = {}) {
  const f = new Intl.NumberFormat(i18n.language === 'es' ? 'es-MX' : 'en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  });
  const s = f.format(Math.abs(value));
  if (opts.sign && value !== 0) return (value > 0 ? '+' : '−') + s;
  return value < 0 ? '−' + s : s;
}

export const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
