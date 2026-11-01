import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { Empty, ErrorText, Icon, Segmented } from '@/components/ui';
import type { Category, CategoryType } from '@/domain/types';
import { useCategories } from './hooks';

export function CategoriesPage() {
  const { t } = useTranslation();
  const cats = useCategories();
  const invalidate = useInvalidate();
  const [type, setType] = useState<CategoryType>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [newName, setNewName] = useState('');

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    try {
      unwrap(await fn());
      invalidate('categories');
    } catch (e) {
      setError(e);
    }
  };

  const parents = cats.list.filter((c) => c.type === type && !c.parent_id && (showArchived || !c.archived));
  const childrenOf = (id: string) => cats.list.filter((c) => c.parent_id === id && (showArchived || !c.archived));

  const add = (name: string, parent_id: string | null) => {
    if (!name.trim()) return;
    const siblings = parent_id ? childrenOf(parent_id) : parents;
    return run(() => supabase.from('categories').insert({ name: name.trim(), type, parent_id, position: siblings.length }));
  };
  const rename = (c: Category) => {
    const name = prompt(t('finance.renameCategory'), c.name);
    if (name && name.trim() !== c.name) run(() => supabase.from('categories').update({ name: name.trim() }).eq('id', c.id));
  };
  const toggleArchive = (c: Category) => run(() => supabase.from('categories').update({ archived: !c.archived }).eq('id', c.id));

  return (
    <div className="space-y-4">
      <Segmented
        className="w-full sm:w-auto"
        value={type}
        onChange={setType}
        options={[
          { value: 'expense', label: t('finance.types.expense') },
          { value: 'income', label: t('finance.types.income') },
        ]}
      />
      <ErrorText error={error} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(newName, null)?.then(() => setNewName(''));
        }}
      >
        <input className="input" placeholder={t('finance.newCategory')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-primary" aria-label={t('common.add')}>
          <Icon name="plus" size={18} />
        </button>
      </form>
      {parents.length === 0 ? (
        <Empty>{t('finance.noCategories')}</Empty>
      ) : (
        <div className="space-y-2">
          {parents.map((p) => (
            <CategoryNode key={p.id} cat={p} subs={childrenOf(p.id)} onAddSub={(n) => add(n, p.id)} onRename={rename} onArchive={toggleArchive} />
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('common.showArchived')}
      </label>
    </div>
  );
}

function CategoryNode({ cat, subs, onAddSub, onRename, onArchive }: { cat: Category; subs: Category[]; onAddSub: (name: string) => Promise<void> | undefined; onRename: (c: Category) => void; onArchive: (c: Category) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="card p-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button className="flex flex-1 items-center gap-1 text-left text-sm font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} className="text-muted" />
          <span className={cat.archived ? 'text-muted line-through' : ''}>{cat.name}</span>
          <span className="text-xs text-muted">{subs.length || ''}</span>
        </button>
        <RowActions cat={cat} onRename={onRename} onArchive={onArchive} />
      </div>
      {open && (
        <div className="border-t border-border px-3 py-2 pl-8">
          {subs.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <span className={`flex-1 text-sm ${s.archived ? 'text-muted line-through' : ''}`}>{s.name}</span>
              <RowActions cat={s} onRename={onRename} onArchive={onArchive} />
            </div>
          ))}
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onAddSub(draft)?.then(() => setDraft(''));
            }}
          >
            <input className="input py-1" placeholder={t('finance.newSubcategory')} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn-ghost py-1" aria-label={t('common.add')}>
              <Icon name="plus" size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function RowActions({ cat, onRename, onArchive }: { cat: Category; onRename: (c: Category) => void; onArchive: (c: Category) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 gap-1">
      <button className="rounded p-1 text-muted hover:bg-surface" onClick={() => onRename(cat)} aria-label={t('common.rename')}>
        <Icon name="edit" size={16} />
      </button>
      <button className="rounded px-1.5 text-xs text-muted hover:bg-surface" onClick={() => onArchive(cat)}>
        {cat.archived ? t('common.restore') : t('common.archive')}
      </button>
    </div>
  );
}
