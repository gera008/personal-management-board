import { useEffect, useState } from 'react';

const TOKENS = ['fg', 'muted', 'border', 'line', 'surface', 'card', 'bg', 'accent', 'expense', 'income', 'transfer', 'habit', 'calendar', 'tasks', 'slip'] as const;
type Token = (typeof TOKENS)[number];

function read(): Record<Token, string> {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, `rgb(${s.getPropertyValue(`--${t}`).trim()})`])) as Record<Token, string>;
}

/**
 * Resolved theme colors for libraries (Recharts) that write SVG attributes,
 * where CSS variables don't resolve. Updates when the accent changes.
 */
export function useThemeColors() {
  const [c, setC] = useState(read);
  useEffect(() => {
    const update = () => setC(read());
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });
    return () => obs.disconnect();
  }, []);
  return c;
}
