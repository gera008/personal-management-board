import { addDays, startOfWeek, subDays } from 'date-fns';
import { toDateKey } from '@/domain/dates';
import { formatDate } from '@/lib/format';

/**
 * GitHub-style year heatmap. Values: null = not due, 0..1 = progress,
 * -1 = slip (bad habit). Scrolls horizontally inside its own box only.
 */
export function Heatmap({
  values,
  end = new Date(),
  weekStartsOn = 0,
  color = 'var(--habit)',
  weeks = 53,
  onSelect,
}: {
  values: Map<string, number | null>;
  end?: Date;
  weekStartsOn?: 0 | 1;
  color?: string;
  weeks?: number;
  /** Called with a day's key when a loggable cell (not future, not "not due") is tapped. */
  onSelect?: (date: string) => void;
}) {
  const first = startOfWeek(subDays(end, (weeks - 1) * 7), { weekStartsOn });
  const cell = 11;
  const gap = 2;
  const cols: { key: string; v: number | null | undefined; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(first, w * 7 + d);
      const key = toDateKey(day);
      col.push({ key, v: values.get(key), future: day > end });
    }
    cols.push(col);
  }
  const fill = (v: number | null | undefined, future: boolean) => {
    if (future) return 'transparent';
    if (v == null) return 'rgb(var(--surface))';
    if (v < 0) return 'rgb(var(--expense))';
    if (v === 0) return 'rgb(var(--border))';
    const a = v >= 1 ? 1 : v >= 0.66 ? 0.7 : v >= 0.33 ? 0.45 : 0.25;
    return `rgb(${color} / ${a})`;
  };
  const width = weeks * (cell + gap);
  const height = 7 * (cell + gap) + 14;
  return (
    <div className="-mx-1 overflow-x-auto px-1" dir="rtl">
      <svg width={width} height={height} role="img" aria-label="Heatmap" style={{ direction: 'ltr' }}>
        {cols.map((col, w) => {
          const firstOfMonth = col.find((c) => c.key.endsWith('-01'));
          return (
            <g key={w} transform={`translate(${w * (cell + gap)},14)`}>
              {firstOfMonth && (
                <text y={-4} fontSize={9} fill="rgb(var(--muted))">
                  {formatDate(firstOfMonth.key, 'MMM')}
                </text>
              )}
              {col.map((c, d) => (
                <rect
                  key={c.key}
                  y={d * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2}
                  fill={fill(c.v, c.future)}
                  onClick={onSelect && !c.future && c.v != null ? () => onSelect(c.key) : undefined}
                  style={onSelect && !c.future && c.v != null ? { cursor: 'pointer' } : undefined}
                >
                  <title>{`${c.key}${c.v == null ? '' : c.v < 0 ? ' ✕' : ` ${Math.round(c.v * 100)}%`}`}</title>
                </rect>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
