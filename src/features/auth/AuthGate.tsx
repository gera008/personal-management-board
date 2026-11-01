import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase';
import { ErrorText } from '@/components/ui';

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <SetupNeeded />;
  if (session === undefined) return null;
  if (!session) return <Login />;
  return <>{children(session)}</>;
}

function SetupNeeded() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold">Personal Hub</h1>
      <p className="text-sm text-muted">{t('auth.setupNeeded')}</p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-surface p-3 text-xs">VITE_SUPABASE_URL=…{'\n'}VITE_SUPABASE_ANON_KEY=…</pre>
    </main>
  );
}

function Login() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setNotice(t('auth.checkEmail'));
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setNotice(t('auth.checkEmail'));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8 flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
        <h1 className="text-2xl font-bold">Personal Hub</h1>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <ErrorText error={error} />
        {notice && <p className="rounded-lg bg-surface px-3 py-2 text-sm">{notice}</p>}
        <input className="input" type="email" required autoComplete="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== 'magic' && (
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {t(`auth.${mode}`)}
        </button>
      </form>
      <div className="mt-4 flex flex-col gap-1 text-center text-sm text-muted">
        {mode !== 'signin' && <button onClick={() => setMode('signin')}>{t('auth.haveAccount')}</button>}
        {mode !== 'signup' && <button onClick={() => setMode('signup')}>{t('auth.createAccount')}</button>}
        {mode !== 'magic' && <button onClick={() => setMode('magic')}>{t('auth.useMagic')}</button>}
      </div>
    </main>
  );
}
