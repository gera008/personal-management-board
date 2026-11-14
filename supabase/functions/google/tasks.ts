// Two-way sync between the app's tasks and Google Tasks.
//
//   categories (task_lists) <-> Google task lists (matched by name the first time;
//                               Google lists the app doesn't have become categories)
//   tasks                   <-> Google tasks: title, notes, due date, done
//   subtasks                <-> Google subtasks (tasks with a parent)
//
// Google Tasks has no time, priority, tags, reminder or repetition. Those stay in
// the app; the due time rides as a hidden last line of the notes in Google
// (see _shared/gmapping.ts). Google Tasks has no sync token, so each list
// remembers when it was last pulled and asks for what changed since.
//
// Order: lists, deletions, pull (Google -> app), then push (app -> Google).
// Pulling first lets the first sync of a list link tasks that already exist on
// both sides (same title and date) instead of duplicating them. When both sides
// changed a task since the last sync, the newer change wins.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { notesForGoogle, notesFromGoogle } from '../_shared/gmapping.ts';
import { countBefore, nextOccurrence, type Recurrence } from '../_shared/recurrence.ts';

export type TasksCall = (method: string, path: string, body?: unknown) => Promise<{ status: number; ok: boolean; data: any }>;

interface GTask {
  id: string;
  etag: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  updated: string;
}

interface AppList {
  id: string;
  name: string;
  google_tasklist_id: string | null;
  google_pulled_at: string | null;
  needs_push: boolean;
}

interface AppTask {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: number;
  tags: string[];
  position: number;
  completed_at: string | null;
  reminder_at: string | null;
  recurrence: (Recurrence & { anchor?: string }) | null;
  recurrence_index: number;
  updated_at: string;
  google_task_id: string | null;
  google_tasklist_id: string | null;
  google_etag: string | null;
  needs_push: boolean;
}

interface AppSubtask {
  id: string;
  task_id: string;
  title: string;
  position: number;
  completed_at: string | null;
  updated_at: string;
  google_task_id: string | null;
  google_etag: string | null;
  needs_push: boolean;
}

/** Tasks done longer ago than this aren't sent to Google the first time. */
const OLD_DONE_DAYS = 30;

const stamp = () => ({ google_synced_at: new Date().toISOString(), needs_push: false });
const enc = encodeURIComponent;
const sameTitle = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Google's due is a date at midnight UTC; the time part is ignored by Google. */
const dueToGoogle = (date: string | null) => (date ? `${date}T00:00:00.000Z` : null);
const dueFromGoogle = (due: string | undefined) => (due ? due.slice(0, 10) : null);

/** Every page of a Google Tasks list call; throws with Google's reason when it fails. */
async function listAll<T>(call: TasksCall, path: string, what: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await call('GET', `${path}${pageToken ? `${sep}pageToken=${enc(pageToken)}` : ''}`);
    if (!res.ok) throw new Error(`${what}: ${res.status} ${res.data?.error?.message ?? ''}`.trim());
    out.push(...((res.data?.items ?? []) as T[]));
    pageToken = res.data?.nextPageToken;
    if (!pageToken) return out;
  }
}

/** The next instance of a repeating task completed in Google (mirrors nextTaskInstance in the app). */
async function createNextInstance(db: SupabaseClient, userId: string, task: AppTask) {
  if (!task.recurrence || !task.due_date) return;
  const anchor = task.recurrence.anchor ?? task.due_date;
  const due = nextOccurrence(anchor, task.recurrence, task.due_date);
  if (!due) return;
  const shift = Date.parse(`${due}T00:00:00Z`) - Date.parse(`${task.due_date}T00:00:00Z`);
  const { data, error } = await db
    .from('tasks')
    .insert({
      user_id: userId,
      list_id: task.list_id,
      title: task.title,
      notes: task.notes,
      due_date: due,
      due_time: task.due_time,
      priority: task.priority,
      tags: task.tags,
      position: task.position,
      recurrence: task.recurrence,
      recurrence_parent_id: task.id,
      recurrence_index: countBefore(anchor, task.recurrence, due) + 1,
      reminder_at: task.reminder_at ? new Date(new Date(task.reminder_at).getTime() + shift).toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !data) return; // 23505: the next one already exists
  const { data: subs } = await db.from('subtasks').select('title,position').eq('task_id', task.id);
  if (subs?.length) await db.from('subtasks').insert(subs.map((s) => ({ user_id: userId, task_id: data.id, title: s.title, position: s.position })));
}

/** Deletes an app row that Google already deleted, without queueing a deletion back to Google. */
async function dropLinked(db: SupabaseClient, table: 'tasks' | 'subtasks', id: string) {
  await db.from(table).update({ google_task_id: null, ...stamp() }).eq('id', id);
  await db.from(table).delete().eq('id', id);
}

// ---------- lists ----------

async function syncLists(db: SupabaseClient, call: TasksCall, userId: string, failed: string[]): Promise<AppList[]> {
  const google = await listAll<{ id: string; title: string; etag: string }>(call, '/users/@me/lists?maxResults=100', 'No se pudieron leer las listas de Google Tasks');
  const { data } = await db.from('task_lists').select('id,name,google_tasklist_id,google_pulled_at,needs_push').eq('user_id', userId).order('position');
  const lists = (data ?? []) as AppList[];
  const byId = new Map(google.map((g) => [g.id, g]));
  const linked = new Set(lists.map((l) => l.google_tasklist_id).filter(Boolean));

  for (const l of lists) {
    if (l.google_tasklist_id && !byId.has(l.google_tasklist_id)) {
      // Deleted in Google. Nothing is deleted in the app: the category and its
      // tasks are unlinked and go back to Google as a new list below.
      await db.from('tasks').update({ google_task_id: null, google_tasklist_id: null, google_etag: null, ...stamp() }).eq('list_id', l.id);
      const { data: taskIds } = await db.from('tasks').select('id').eq('list_id', l.id);
      if (taskIds?.length) await db.from('subtasks').update({ google_task_id: null, google_etag: null, ...stamp() }).in('task_id', taskIds.map((t) => t.id));
      linked.delete(l.google_tasklist_id);
      l.google_tasklist_id = null;
      l.google_pulled_at = null;
    }
    if (!l.google_tasklist_id) {
      // First time: a Google list with the same name is the same category.
      const match = google.find((g) => !linked.has(g.id) && sameTitle(g.title, l.name));
      const res = match ? { ok: true, status: 200, data: match } : await call('POST', '/users/@me/lists', { title: l.name });
      if (!res.ok) {
        failed.push(`lista "${l.name}": ${res.status}`);
        continue;
      }
      l.google_tasklist_id = res.data.id;
      linked.add(res.data.id);
      await db.from('task_lists').update({ google_tasklist_id: res.data.id, google_etag: res.data.etag, google_pulled_at: null, ...stamp() }).eq('id', l.id);
      // Renamed in the app and matched by the old name doesn't happen: a fresh link always uses the app's name.
    } else if (l.needs_push) {
      const res = await call('PATCH', `/users/@me/lists/${enc(l.google_tasklist_id)}`, { title: l.name });
      if (res.ok) await db.from('task_lists').update({ google_etag: res.data.etag, ...stamp() }).eq('id', l.id);
      else failed.push(`lista "${l.name}": ${res.status}`);
    } else {
      // Renamed in Google.
      const g = byId.get(l.google_tasklist_id)!;
      if (g.title && g.title !== l.name) {
        await db.from('task_lists').update({ name: g.title, google_etag: g.etag, ...stamp() }).eq('id', l.id);
        l.name = g.title;
      }
    }
  }

  // Google lists the app doesn't have become new categories.
  for (const g of google) {
    if (linked.has(g.id)) continue;
    const { data: created } = await db
      .from('task_lists')
      .insert({ user_id: userId, name: g.title || 'Google Tasks', position: lists.length, google_tasklist_id: g.id, google_etag: g.etag, ...stamp() })
      .select('id,name,google_tasklist_id,google_pulled_at,needs_push')
      .single();
    if (created) lists.push(created as AppList);
  }
  return lists.filter((l) => l.google_tasklist_id);
}

async function pushDeletions(db: SupabaseClient, call: TasksCall, userId: string) {
  const { data: dels } = await db.from('google_task_deletions').select('*').eq('user_id', userId).order('id');
  for (const d of dels ?? []) {
    const path = d.task_id ? `/lists/${enc(d.tasklist_id)}/tasks/${enc(d.task_id)}` : `/users/@me/lists/${enc(d.tasklist_id)}`;
    const res = await call('DELETE', path);
    if (res.ok || res.status === 404 || res.status === 410) await db.from('google_task_deletions').delete().eq('id', d.id);
  }
}

// ---------- pull: Google -> app ----------

async function pullList(db: SupabaseClient, call: TasksCall, userId: string, list: AppList) {
  const started = new Date();
  const params = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'true' });
  // A little overlap so a change made during the last pull isn't missed.
  if (list.google_pulled_at) params.set('updatedMin', new Date(Date.parse(list.google_pulled_at) - 120_000).toISOString());
  const items = await listAll<GTask>(call, `/lists/${enc(list.google_tasklist_id!)}/tasks?${params}`, `No se pudo leer la lista "${list.name}" de Google Tasks`);
  const firstPull = !list.google_pulled_at;

  // Parents first, so subtasks find their task.
  items.sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
  for (const t of items) {
    if (t.parent) await pullSubtask(db, userId, t);
    else await pullTask(db, userId, list, t, firstPull);
  }
  await db.from('task_lists').update({ google_pulled_at: started.toISOString(), google_synced_at: new Date().toISOString() }).eq('id', list.id);
}

async function pullTask(db: SupabaseClient, userId: string, list: AppList, t: GTask, firstPull: boolean) {
  const cols = 'id,list_id,title,notes,due_date,due_time,priority,tags,position,completed_at,reminder_at,recurrence,recurrence_index,updated_at,google_task_id,google_tasklist_id,google_etag,needs_push';
  let existing = (await db.from('tasks').select(cols).eq('user_id', userId).eq('google_task_id', t.id).maybeSingle()).data as AppTask | null;

  if (t.deleted) {
    if (existing) await dropLinked(db, 'tasks', existing.id);
    return;
  }
  const due_date = dueFromGoogle(t.due);

  // First sync of a list: a task already in both places is linked, not duplicated.
  if (!existing && firstPull) {
    const { data: candidates } = await db.from('tasks').select(cols).eq('user_id', userId).eq('list_id', list.id).is('google_task_id', null);
    existing = ((candidates ?? []) as AppTask[]).find((c) => sameTitle(c.title, t.title) && c.due_date === due_date) ?? null;
    if (existing) {
      // Linked as is; the app's version is pushed next (it has the time and notes).
      await db.from('tasks').update({ google_task_id: t.id, google_tasklist_id: list.google_tasklist_id, google_etag: null, google_synced_at: new Date().toISOString(), needs_push: true }).eq('id', existing.id);
      return;
    }
  }

  if (existing && existing.google_etag === t.etag && !existing.needs_push) return;
  if (existing?.needs_push && new Date(existing.updated_at) > new Date(t.updated)) return;

  const { notes, time } = notesFromGoogle(t.notes);
  const done = t.status === 'completed';
  const row = {
    title: (t.title ?? '').trim() || '(sin título)',
    notes,
    due_date,
    due_time: due_date ? time : null,
    completed_at: done ? existing?.completed_at ?? t.completed ?? new Date().toISOString() : null,
    list_id: list.id,
    google_task_id: t.id,
    google_tasklist_id: list.google_tasklist_id,
    google_etag: t.etag,
    // A repeating task needs a date; if Google removed it, it stops repeating.
    ...(existing?.recurrence && !due_date ? { recurrence: null } : {}),
    ...stamp(),
  };

  if (existing) {
    await db.from('tasks').update(row).eq('id', existing.id);
    if (done && !existing.completed_at && existing.recurrence && due_date) await createNextInstance(db, userId, { ...existing, ...row, due_date });
  } else {
    if (!t.title?.trim() && !t.notes?.trim()) return; // Google's empty placeholder rows
    await db.from('tasks').insert({ user_id: userId, position: 0, ...row });
  }
}

async function pullSubtask(db: SupabaseClient, userId: string, t: GTask) {
  const existing = (await db.from('subtasks').select('id,completed_at,updated_at,google_etag,needs_push').eq('user_id', userId).eq('google_task_id', t.id).maybeSingle()).data as AppSubtask | null;
  if (t.deleted) {
    if (existing) await dropLinked(db, 'subtasks', existing.id);
    return;
  }
  if (existing && existing.google_etag === t.etag && !existing.needs_push) return;
  if (existing?.needs_push && new Date(existing.updated_at) > new Date(t.updated)) return;
  const { data: parent } = await db.from('tasks').select('id').eq('user_id', userId).eq('google_task_id', t.parent!).maybeSingle();
  if (!parent) return; // its task isn't in the app (yet)
  const done = t.status === 'completed';
  const row = {
    task_id: parent.id,
    title: (t.title ?? '').trim() || '(sin título)',
    completed_at: done ? existing?.completed_at ?? t.completed ?? new Date().toISOString() : null,
    google_task_id: t.id,
    google_etag: t.etag,
    ...stamp(),
  };
  if (existing) await db.from('subtasks').update(row).eq('id', existing.id);
  else {
    if (!t.title?.trim()) return;
    const { count } = await db.from('subtasks').select('id', { count: 'exact', head: true }).eq('task_id', parent.id);
    await db.from('subtasks').insert({ user_id: userId, position: count ?? 0, ...row });
  }
}

// ---------- push: app -> Google ----------

function taskBody(t: AppTask) {
  const done = !!t.completed_at;
  return {
    title: t.title,
    notes: notesForGoogle(t.notes, t.due_time),
    due: dueToGoogle(t.due_date),
    status: done ? 'completed' : 'needsAction',
    completed: done ? t.completed_at : null,
  };
}

async function pushTasks(db: SupabaseClient, call: TasksCall, userId: string, lists: AppList[], failed: string[]) {
  const listGid = new Map(lists.map((l) => [l.id, l.google_tasklist_id!]));
  const recent = new Date(Date.now() - OLD_DONE_DAYS * 86_400_000).toISOString();
  const cols = 'id,list_id,title,notes,due_date,due_time,priority,tags,position,completed_at,reminder_at,recurrence,recurrence_index,updated_at,google_task_id,google_tasklist_id,google_etag,needs_push';
  // Changed tasks, plus tasks never sent (pending, or done recently).
  const { data } = await db
    .from('tasks')
    .select(cols)
    .eq('user_id', userId)
    .or(`needs_push.eq.true,and(google_task_id.is.null,or(completed_at.is.null,completed_at.gt."${recent}"))`)
    .order('created_at')
    .limit(300);
  let pushed = 0;
  for (const t of (data ?? []) as AppTask[]) {
    const gl = listGid.get(t.list_id);
    if (!gl) continue; // its category isn't linked yet
    let gid = t.google_task_id;
    // Moved to another category: Google needs it deleted from the old list and created in the new one.
    if (gid && t.google_tasklist_id && t.google_tasklist_id !== gl) {
      await call('DELETE', `/lists/${enc(t.google_tasklist_id)}/tasks/${enc(gid)}`);
      await db.from('subtasks').update({ google_task_id: null, google_etag: null, needs_push: true }).eq('task_id', t.id);
      gid = null;
    }
    const res = gid ? await call('PATCH', `/lists/${enc(gl)}/tasks/${enc(gid)}`, taskBody(t)) : await call('POST', `/lists/${enc(gl)}/tasks`, taskBody(t));
    if (res.status === 404 && gid) {
      // Gone in Google meanwhile: the next pull removes it.
      continue;
    }
    if (!res.ok) {
      failed.push(`tarea "${t.title}": ${res.status} ${res.data?.error?.message ?? ''}`.trim());
      continue;
    }
    await db.from('tasks').update({ google_task_id: res.data.id, google_tasklist_id: gl, google_etag: res.data.etag, ...stamp() }).eq('id', t.id);
    if (!gid) await db.from('subtasks').update({ needs_push: true }).eq('task_id', t.id).is('google_task_id', null);
    pushed++;
  }

  // Subtasks of tasks that are in Google.
  const { data: subs } = await db
    .from('subtasks')
    .select('id,task_id,title,position,completed_at,updated_at,google_task_id,google_etag,needs_push, tasks!inner(google_task_id,google_tasklist_id)')
    .eq('user_id', userId)
    .or('needs_push.eq.true,google_task_id.is.null')
    .not('tasks.google_task_id', 'is', null)
    .order('position')
    .limit(500);
  for (const s of (subs ?? []) as unknown as (AppSubtask & { tasks: { google_task_id: string; google_tasklist_id: string } })[]) {
    const gl = s.tasks.google_tasklist_id;
    const done = !!s.completed_at;
    const body = { title: s.title, status: done ? 'completed' : 'needsAction', completed: done ? s.completed_at : null };
    const res = s.google_task_id
      ? await call('PATCH', `/lists/${enc(gl)}/tasks/${enc(s.google_task_id)}`, body)
      : await call('POST', `/lists/${enc(gl)}/tasks?parent=${enc(s.tasks.google_task_id)}`, body);
    if (!res.ok) {
      if (!(res.status === 404 && s.google_task_id)) failed.push(`subtarea "${s.title}": ${res.status}`);
      continue;
    }
    await db.from('subtasks').update({ google_task_id: res.data.id, google_etag: res.data.etag, ...stamp() }).eq('id', s.id);
    pushed++;
  }
  return pushed;
}

// ---------- entry point ----------

export async function syncTasks(db: SupabaseClient, call: TasksCall, userId: string) {
  const failed: string[] = [];
  const lists = await syncLists(db, call, userId, failed);
  await pushDeletions(db, call, userId);
  for (const l of lists) await pullList(db, call, userId, l);
  const pushed = await pushTasks(db, call, userId, lists, failed);
  return { lists: lists.length, pushed, failed };
}
