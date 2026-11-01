import { supabase } from './supabase';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS only allows push for apps added to the home screen. */
export const isIosBrowserTab = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<void> {
  if (!VAPID) throw new Error('VITE_VAPID_PUBLIC_KEY is not set');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) }));
  const json = sub.toJSON();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent }, { onConflict: 'user_id,endpoint' });
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(): Promise<void> {
  const { error } = await supabase.functions.invoke('push', { body: { mode: 'test' } });
  if (error) throw new Error(error.message);
}
