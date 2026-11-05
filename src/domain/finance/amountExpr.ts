/**
 * Amount fields accept quick sums and subtractions, e.g. "120+35.50-10".
 * Returns the rounded result, or null while the text isn't a complete
 * expression (empty, a trailing operator, letters…).
 */
export function evalAmount(text: string): number | null {
  // Commas are decimal separators here (as everywhere else in the forms); spaces are ignored.
  const s = text.replace(/\s+/g, '').replace(/,/g, '.').replace(/[−–]/g, '-');
  if (!/^[+-]?\d*\.?\d+([+-]\d*\.?\d+)*$/.test(s)) return null;
  const total = (s.match(/[+-]?[^+-]+/g) ?? []).reduce((sum, term) => sum + Number(term), 0);
  return Math.round(total * 100) / 100;
}

/** True when the text has an operator to resolve (so the form can show "= result"). */
export const isExpression = (text: string) => /\d\s*[+\-−–]/.test(text);
