import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';

/**
 * Module selector: a dial you turn to pick a module (like a watch crown).
 * Phones: half circle at the bottom, pointer at 12 o'clock.
 * Wide screens: half circle on the left edge, pointer at 3 o'clock.
 * Idle it shrinks into the background; touching, dragging, scrolling or
 * using the arrow keys brings it forward until it rests again.
 */
export const MODULES = [
  { to: '/', icon: 'home', key: 'nav.home' },
  { to: '/calendar', icon: 'calendar', key: 'nav.calendar' },
  { to: '/tasks', icon: 'tasks', key: 'nav.tasks' },
  { to: '/finance', icon: 'finance', key: 'nav.finance' },
  { to: '/health', icon: 'habits', key: 'nav.health' },
] as const;

const N = MODULES.length;
const STEP = 360 / N;
export const DIAL_R = 170; // outer radius of the dial
const ITEM = 52; // module button size
const ITEM_R = DIAL_R - 58; // where the buttons sit
const NOTCH = 24; // room for the pointer outside the dial
const IDLE_MS = 1600;
/** Idle size, as a share of the active one. */
export const IDLE_SCALE = 0.56;

export type DialSide = 'bottom' | 'left';

export function moduleIndex(pathname: string): number {
  if (pathname.startsWith('/calendar')) return 1;
  if (pathname.startsWith('/tasks')) return 2;
  if (pathname.startsWith('/finance')) return 3;
  if (pathname.startsWith('/health') || pathname.startsWith('/habits')) return 4;
  if (pathname === '/') return 0;
  return -1; // Settings and other pages: no module highlighted
}

/** Which module sits under the pointer for a dial rotation (degrees). */
export const indexForRotation = (rot: number) => ((Math.round(-rot / STEP) % N) + N) % N;

/** Position of a button `deg` degrees clockwise from the pointer, inside the dial box. */
function place(deg: number, side: DialSide) {
  const a = (deg * Math.PI) / 180;
  const x = side === 'bottom' ? DIAL_R + ITEM_R * Math.sin(a) : DIAL_R + ITEM_R * Math.cos(a);
  const y = side === 'bottom' ? DIAL_R - ITEM_R * Math.cos(a) : DIAL_R + ITEM_R * Math.sin(a);
  return { left: x - ITEM / 2, top: y - ITEM / 2 };
}

function ticks() {
  const lines = [];
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const long = i % 3 === 0;
    const r1 = DIAL_R - 6;
    const r2 = DIAL_R - (long ? 16 : 11);
    lines.push(
      <line
        key={i}
        x1={DIAL_R + r1 * Math.sin(a)}
        y1={DIAL_R - r1 * Math.cos(a)}
        x2={DIAL_R + r2 * Math.sin(a)}
        y2={DIAL_R - r2 * Math.cos(a)}
        stroke={long ? 'rgb(var(--line))' : 'rgb(var(--border))'}
        strokeWidth={long ? 2 : 1.5}
        strokeLinecap="round"
      />,
    );
  }
  return lines;
}
const TICKS = ticks();

export function ModuleDial({ side }: { side: DialSide }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const routeIndex = moduleIndex(pathname);

  const dock = useRef<HTMLDivElement>(null);
  const dial = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const rot = useRef(-Math.max(0, routeIndex) * STEP);
  const [current, setCurrent] = useState(Math.max(0, routeIndex));
  const [active, setActive] = useState(false);
  const idle = useRef<number>();

  // Paint the dial straight from refs while dragging (no re-render per frame).
  const paint = useCallback((animate: boolean) => {
    const ease = 'cubic-bezier(.2,.9,.3,1.15)';
    if (dial.current) {
      dial.current.style.transition = animate ? `transform .45s ${ease}` : 'none';
      dial.current.style.transform = `rotate(${rot.current}deg)`;
    }
    items.current.forEach((el, i) => {
      if (!el) return;
      const off = ((((i * STEP + rot.current) % 360) + 540) % 360) - 180; // degrees from the pointer
      el.style.transition = animate ? `opacity .45s, transform .45s ${ease}` : 'none';
      el.style.opacity = String(Math.max(0.15, 1 - Math.abs(off) / 120));
      const ico = el.firstElementChild as HTMLElement | null;
      if (ico) {
        ico.style.transition = animate ? `transform .45s ${ease}, background .2s, color .2s` : 'background .2s, color .2s';
        ico.style.transform = `rotate(${-rot.current}deg)`;
      }
    });
    setCurrent(indexForRotation(rot.current));
  }, []);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idle.current);
  }, []);
  const rest = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setActive(false), IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(idle.current), []);

  // Turn to a module by the shortest way and open it.
  const goTo = useCallback(
    (i: number, open = true) => {
      let target = -i * STEP;
      target += Math.round((rot.current - target) / 360) * 360;
      rot.current = target;
      paint(true);
      if (open && moduleIndex(window.location.pathname) !== i) navigate(MODULES[i].to);
    },
    [navigate, paint],
  );

  useLayoutEffect(() => paint(false), [paint, side]);
  // Follow navigation that didn't come from the dial (links, back button).
  useEffect(() => {
    if (routeIndex >= 0 && routeIndex !== indexForRotation(rot.current)) goTo(routeIndex, false);
  }, [routeIndex, goTo]);

  // A small tick on phones each time a new module reaches the pointer.
  const last = useRef(current);
  useEffect(() => {
    if (last.current !== current && active) navigator.vibrate?.(8);
    last.current = current;
  }, [current, active]);

  // ----- Dragging around the center -----
  const angle = (e: { clientX: number; clientY: number }) => {
    const b = dial.current!.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = e.clientY - (b.top + b.height / 2);
    // Clockwise degrees from the pointer direction (up, or right on the left edge).
    return ((side === 'bottom' ? Math.atan2(dx, -dy) : Math.atan2(dy, dx)) * 180) / Math.PI;
  };
  const drag = useRef<{ last: number; moved: number; item: number | null } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    wake();
    const btn = (e.target as HTMLElement).closest('[data-i]');
    drag.current = { last: angle(e), moved: 0, item: btn ? Number(btn.getAttribute('data-i')) : null };
    dock.current?.setPointerCapture(e.pointerId);
    paint(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const a = angle(e);
    let delta = a - d.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    rot.current += delta;
    d.last = a;
    d.moved += Math.abs(delta);
    paint(false);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved < 3) {
      // A tap: open the tapped module; a tap elsewhere just wakes the dial.
      if (d.item != null) goTo(d.item);
      else goTo(indexForRotation(rot.current), false);
    } else {
      goTo(indexForRotation(rot.current)); // snap to the nearest module
    }
    rest();
  };

  // ----- Mouse wheel and keyboard -----
  const wheel = useRef(0);
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wake();
      wheel.current += e.deltaY + e.deltaX;
      if (Math.abs(wheel.current) > 40) {
        goTo((indexForRotation(rot.current) + (wheel.current > 0 ? 1 : N - 1)) % N);
        wheel.current = 0;
      }
      rest();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [goTo, wake, rest]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = side === 'bottom' ? ['ArrowRight', 'ArrowDown'] : ['ArrowDown', 'ArrowRight'];
    const prev = side === 'bottom' ? ['ArrowLeft', 'ArrowUp'] : ['ArrowUp', 'ArrowLeft'];
    if (![...next, ...prev].includes(e.key)) return;
    e.preventDefault();
    wake();
    goTo((indexForRotation(rot.current) + (next.includes(e.key) ? 1 : N - 1)) % N);
    rest();
  };

  const bottom = side === 'bottom';
  const name = t(MODULES[current].key);
  const highlighted = active || routeIndex >= 0 ? current : -1;

  return (
    <div
      ref={dock}
      role="slider"
      tabIndex={0}
      aria-label={t('nav.selector')}
      aria-valuemin={1}
      aria-valuemax={N}
      aria-valuenow={current + 1}
      aria-valuetext={name}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={wake}
      onBlur={rest}
      className="fixed z-40 touch-none select-none overflow-hidden outline-none transition-transform duration-300 ease-out"
      style={
        bottom
          ? {
              left: '50%',
              bottom: 0,
              width: DIAL_R * 2,
              height: DIAL_R + NOTCH,
              marginLeft: -DIAL_R,
              transformOrigin: 'bottom center',
              transform: `scale(${active ? 1 : IDLE_SCALE})`,
            }
          : {
              left: 0,
              top: '50%',
              width: DIAL_R + NOTCH,
              height: DIAL_R * 2,
              marginTop: -DIAL_R,
              transformOrigin: 'left center',
              transform: `scale(${active ? 1 : IDLE_SCALE})`,
            }
      }
    >
      {/* Pointer */}
      <div
        className="absolute z-10 h-0 w-0"
        style={
          bottom
            ? { left: '50%', top: 14, marginLeft: -7, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '9px solid rgb(var(--accent))' }
            : { top: '50%', right: 14, marginTop: -7, borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderRight: '9px solid rgb(var(--accent))' }
        }
      />
      <div
        ref={dial}
        className="absolute rounded-full border border-border bg-card will-change-transform"
        style={{ width: DIAL_R * 2, height: DIAL_R * 2, ...(bottom ? { left: 0, top: NOTCH } : { left: -DIAL_R, top: 0 }) }}
      >
        <svg viewBox={`0 0 ${DIAL_R * 2} ${DIAL_R * 2}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {TICKS}
        </svg>
        {MODULES.map((m, i) => (
          <button
            key={m.to}
            ref={(el) => (items.current[i] = el)}
            data-i={i}
            tabIndex={-1}
            aria-label={t(m.key)}
            className="absolute"
            style={{ width: ITEM, height: ITEM, ...place(i * STEP, side) }}
          >
            <span
              className={`flex h-full w-full items-center justify-center rounded-full border transition-colors ${
                i === highlighted ? 'border-transparent bg-accent text-bg shadow-[0_0_0_6px_rgb(var(--accent)/0.12)]' : 'border-border bg-bg text-muted'
              }`}
            >
              <Icon name={m.icon} size={24} />
            </span>
          </button>
        ))}
      </div>
      {/* Hub with the module's name */}
      <div
        className="pointer-events-none absolute flex flex-col items-center justify-end border border-border bg-bg text-center"
        style={
          bottom
            ? { left: '50%', bottom: 0, width: 156, height: 78, marginLeft: -78, borderRadius: '78px 78px 0 0', borderBottom: 0, paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }
            : { left: 0, top: '50%', width: 92, height: 184, marginTop: -92, borderRadius: '0 92px 92px 0', borderLeft: 0, justifyContent: 'center', paddingRight: 8 }
        }
      >
        {/* Idle, the dial is small: the lit button says enough and the page title names the module. */}
        <b className={`text-[15px] font-semibold leading-tight transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>{name}</b>
        <small className={`mt-0.5 text-[11px] text-muted transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>{t('nav.turnToChange')}</small>
      </div>
    </div>
  );
}
