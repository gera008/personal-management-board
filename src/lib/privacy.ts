import { useSyncExternalStore } from 'react';

// "Hide amounts" switch. It is per device (stored in this browser only), since
// it's about what shows on this screen.
const KEY = 'hideAmounts';
const listeners = new Set<() => void>();

let hidden = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

export const amountsHidden = () => hidden;

export function setAmountsHidden(value: boolean) {
  hidden = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders the caller when the switch changes. */
export function useAmountsHidden(): [boolean, () => void] {
  const value = useSyncExternalStore(subscribe, amountsHidden);
  return [value, () => setAmountsHidden(!value)];
}
