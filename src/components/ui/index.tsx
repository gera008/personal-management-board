import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-bg sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-lg p-1 text-muted hover:bg-surface" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-border px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{footer}</div>}
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
    <div className={`inline-flex rounded-lg border border-border bg-surface p-0.5 ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${value === o.value ? 'bg-bg font-medium shadow-sm' : 'text-muted'}`}
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
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      {children}
    </header>
  );
}

export function Fab({ onClick, label, color = 'bg-fg' }: { onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-bg shadow-lg md:bottom-8 md:right-8 ${color}`}
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
        <button type="button" className="btn-danger" onClick={() => (!confirmDelete || confirm(t('common.confirmDelete'))) && onDelete()}>
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
