import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { addMonths, isSameMonth, startOfMonth } from 'date-fns';
import { formatDate } from '@/lib/format';
import { Icon } from './Icon';

export { Icon } from './Icon';

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-border bg-card sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted hover:text-fg" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`mb-3 block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={`inline-flex rounded-full border border-border bg-card p-1 ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition ${value === o.value ? 'bg-fg font-medium text-bg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Collapsible({ title, storageKey, children, right }: { title: ReactNode; storageKey: string; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`collapse:${storageKey}`) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`collapse:${storageKey}`, open ? '0' : '1');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2">
        <button onClick={toggle} className="flex flex-1 items-center gap-1 text-left text-sm font-semibold" aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} className="text-muted" />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function Progress({ ratio, color = 'bg-fg', className = '' }: { ratio: number; color?: string; className?: string }) {
  const over = ratio > 1;
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-surface ${className}`}>
      <div className={`h-full rounded-full ${over ? 'bg-expense' : color}`} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-title">{title}</h1>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      {children}
    </header>
  );
}

/** Floating "+" button in the accent color. (`accent` is kept for callers; the accent now comes from Settings.) */
export function Fab({ onClick, label }: { onClick: () => void; label: string; accent?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-[0_0_0_6px_rgb(var(--accent)/0.12)] transition active:scale-95 md:bottom-8 md:right-8"
    >
      <Icon name="plus" size={26} />
    </button>
  );
}

export function SaveBar({
  onCancel,
  onDelete,
  saving,
  disabled,
  confirmDelete = true,
}: {
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
  disabled?: boolean;
  /** Set to false when onDelete asks its own question (e.g. which occurrences). */
  confirmDelete?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {onDelete && (
        <button type="button" className="btn-danger" aria-label={t('common.delete')} title={t('common.delete')} onClick={() => (!confirmDelete || confirm(t('common.confirmDelete'))) && onDelete()}>
          <Icon name="trash" size={16} />
        </button>
      )}
      <div className="flex-1" />
      <button type="button" className="btn-ghost" onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="submit" form="sheet-form" className="btn-primary" disabled={saving || disabled}>
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="mb-3 rounded-lg bg-expense/10 px-3 py-2 text-sm text-expense">{error instanceof Error ? error.message : String(error)}</p>;
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="input flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== tag))} aria-label={`Remove ${tag}`}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[6rem] flex-1 bg-transparent outline-none"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/**
 * Compact "‹ November 2026 ›" month switcher. Tapping the month name jumps
 * back to the current month when another one is showing.
 */
export function MonthPicker({ month, onChange, className = '' }: { month: Date; onChange: (m: Date) => void; className?: string }) {
  const { t } = useTranslation();
  const isCurrent = isSameMonth(month, new Date());
  const arrow = 'flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-current';
  return (
    <div className={`flex justify-center ${className}`}>
      <div className="inline-flex items-center gap-1 rounded-full border border-border p-0.5">
        <button className={arrow} onClick={() => onChange(startOfMonth(addMonths(month, -1)))} aria-label={t('common.previous')}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <button
          className={`min-w-[8.5rem] px-1 text-center text-sm font-semibold capitalize ${isCurrent ? 'cursor-default' : 'hover:underline'}`}
          onClick={() => !isCurrent && onChange(startOfMonth(new Date()))}
          title={isCurrent ? undefined : t('finance.thisMonth')}
        >
          {formatDate(month, 'MMMM yyyy')}
        </button>
        <button className={arrow} onClick={() => onChange(startOfMonth(addMonths(month, 1)))} aria-label={t('common.next')}>
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </div>
  );
}
