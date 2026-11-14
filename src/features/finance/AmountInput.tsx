import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { money } from '@/lib/format';
import { evalAmount, isExpression } from '@/domain/finance/amountExpr';
import type { Currency } from '@/domain/types';

/**
 * Amount field that takes quick math ("120+35-10"). The phone's decimal pad has
 * no + or −, so two buttons add them; the result replaces the text on blur.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  className = '',
  autoFocus,
  required,
  hero,
}: {
  value: string;
  onChange: (v: string) => void;
  currency?: Currency;
  className?: string;
  autoFocus?: boolean;
  required?: boolean;
  /** Big centered amount at the top of a form. */
  hero?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const result = evalAmount(value);
  const pending = isExpression(value);

  const addOperator = (op: '+' | '-') => {
    const base = value.trim().replace(/[+\-−–]$/, '');
    if (!base) return;
    onChange(base + op);
    ref.current?.focus();
  };

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          className={
            hero
              ? `w-full bg-transparent px-20 py-1 text-center text-[40px] font-semibold tracking-tight outline-none placeholder:text-muted/40 ${className}`
              : `input pr-20 ${className}`
          }
          inputMode="decimal"
          required={required}
          autoFocus={autoFocus}
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => pending && result != null && onChange(String(result))}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-1">
          {(['+', '-'] as const).map((op) => (
            <button
              key={op}
              type="button"
              tabIndex={-1}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-base font-semibold text-muted hover:text-current"
              aria-label={op === '+' ? t('finance.add') : t('finance.subtract')}
              // Keep the keyboard open: don't let the tap take focus from the field.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => addOperator(op)}
            >
              {op === '+' ? '+' : '−'}
            </button>
          ))}
        </div>
      </div>
      {pending && (
        <span className={`mt-1 block text-xs ${hero ? 'text-center' : ''} ${result == null ? 'text-expense' : 'text-muted'}`}>
          {result == null ? t('finance.incompleteMath') : `= ${money(result, currency)}`}
        </span>
      )}
    </div>
  );
}

/** Numeric value of an amount field, resolving any math in it (NaN when incomplete). */
export const amountValue = (text: string) => evalAmount(text) ?? NaN;
