import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

/**
 * Pieces that only run inside the iPhone app (Capacitor). On the web every
 * helper here falls back to what the browser does by itself.
 *
 * The app owns the `mios://` link scheme (ios/App/App/Info.plist):
 *   mios://auth/callback#access_token=…   an email sign-in link, back from Supabase
 *   mios://google/settings?google=…        back from Google's consent screen
 */
export const isNative = Capacitor.isNativePlatform();

const AUTH_CALLBACK = 'mios://auth/callback';
const GOOGLE_RETURN = 'mios://google';

/** Where an email sign-in/sign-up link should land. */
export const emailRedirect = () => (isNative ? AUTH_CALLBACK : window.location.origin);

/** What the Google consent screen should return to (`returnTo` of the `google` function). */
export const googleReturnTo = () => (isNative ? GOOGLE_RETURN : window.location.origin);

/**
 * Opens a sign-in page of another site. Google refuses its consent screen inside
 * an app's own web view, so the app opens it in Safari's in-app sheet instead.
 */
export async function openExternalAuth(url: string) {
  if (isNative) await Browser.open({ url, presentationStyle: 'popover' });
  else window.location.href = url;
}

async function handleLink(link: string) {
  const url = new URL(link);
  if (link.startsWith(AUTH_CALLBACK)) {
    // Supabase puts the session in the fragment (or an error in either part).
    const params = new URLSearchParams(url.hash.slice(1) || url.search.slice(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const code = params.get('code');
    if (access_token && refresh_token) await supabase.auth.setSession({ access_token, refresh_token });
    else if (code) await supabase.auth.exchangeCodeForSession(code);
    window.location.assign('/');
  } else if (link.startsWith(GOOGLE_RETURN)) {
    await Browser.close().catch(() => undefined);
    const status = url.searchParams.get('google') ?? 'error';
    window.location.assign(`/settings?google=${encodeURIComponent(status)}`);
  }
}

/** Starts listening for `mios://` links. Call once at startup; does nothing on the web. */
export function initNative() {
  if (!isNative) return;
  App.addListener('appUrlOpen', ({ url }) => {
    handleLink(url).catch(() => window.location.assign('/'));
  });
}
