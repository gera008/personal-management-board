import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const IDLE_MS = 2 * 60 * 1000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * After two minutes without any touch, click, key or scroll, go back to the
 * Overview. Also when the app comes back to the front after being away that
 * long. Never while a sheet (form) is open, so nothing typed gets lost.
 */
export function useIdleHome() {
  const navigate = useNavigate();
  useEffect(() => {
    let last = Date.now();
    let timer = 0;
    const formOpen = () => !!document.querySelector('[role="dialog"]');
    const goHome = () => {
      if (window.location.pathname !== '/' && !formOpen()) navigate('/');
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // A form is open: wait for another full idle period.
        if (formOpen()) return arm();
        goHome();
      }, IDLE_MS);
    };
    const activity = () => {
      last = Date.now();
      arm();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last >= IDLE_MS) goHome();
      activity();
    };
    EVENTS.forEach((e) => window.addEventListener(e, activity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisible);
    arm();
    return () => {
      window.clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, activity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);
}
