import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';

/**
 * Module selector: a dial you turn to pick a module (like a watch crown).
 * Phones: half circle at the bottom, pointer at 12 o'clock.
 * Wide screens: half circle on the left edge, pointer at 3 o'clock.
 * Idle it shrinks into the background; touching, dragging, scrolling or
 * using the arrow keys brings it forward
 * until it rests again. The hub in the middle opens the Overview.
 */
export const MODULES = [
  { to: '/calendar', icon: 'calendar', key: 'nav.calendar' },
  { to: '/tasks', icon: 'tasks', key: 'nav.tasks' },
  { to: '/finance', icon: 'finance', key: 'nav.finance' },
  { to: '/health', icon: 'habits', key: 'nav.health' },
] as const;

const N = MODULES.length;
const STEP = 360 / N;
const NOTCH = 24; // room for the pointer outside the dial
const IDLE_MS = 1600;
/** Idle size in pixels (pointer to the far edge), whatever the active size is. */
const IDLE_EXTENT = 110;

export type DialSide = 'bottom' | 'left';

export function moduleIndex(pathname: string): number {
  if (pathname.startsWith('/calendar')) return 0;
  if (pathname.startsWith('/tasks')) return 1;
  if (pathname.startsWith('/finance')) return 2;
  if (pathname.startsWith('/health') || pathname.startsWith('/habits')) return 3;
  return -1; // Overview, Settings: no module lit
}

/** Which module sits under the pointer for a dial rotation (degrees). */
export const indexForRotation = (rot: number) => ((Math.round(-rot / STEP) % N) + N) % N;

/**
 * Active radius: a bit larger than the original 170px (up to 185 on phones,
 * 225 on the left edge), shrunk only if the screen can't fit it.
 */
function radiusFor(side: DialSide, w: number, h: number) {
  return Math.round(side === 'bottom' ? Math.min(185, w / 2 - 10) : Math.min(225, h / 2 - 48));
}

/** Everything that depends on the radius: button size and ring, hub, ticks. */
function geometry(R: number) {
  const k = R / 170;
  const item = Math.round(Math.min(64, 52 * k));
  const itemR = R - Math.round(58 * k);
  const hub = Math.round(78 * k); // hub radius
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const long = i % 3 === 0;
    const r1 = R - 6;
    const r2 = R - (long ? 16 : 11);
    ticks.push(
      <line
        key={i}
        x1={R + r1 * Math.sin(a)}
        y1={R - r1 * Math.cos(a)}
        x2={R + r2 * Math.sin(a)}
        y2={R - r2 * Math.cos(a)}
        stroke={long ? 'rgb(var(--line))' : 'rgb(var(--border))'}
        strokeWidth={long ? 2 : 1.5}
        strokeLinecap="round"
      />,
    );
  }
  return { item, itemR, hub, ticks };
}

/** Position of a button `deg` degrees clockwise from the pointer, inside the dial box. */
function place(deg: number, side: DialSide, R: number, itemR: number, item: number) {
  const a = (deg * Math.PI) / 180;
  const x = side === 'bottom' ? R + itemR * Math.sin(a) : R + itemR * Math.cos(a);
  const y = side === 'bottom' ? R - itemR * Math.cos(a) : R + itemR * Math.sin(a);
  return { left: x - item / 2, top: y - item / 2 };
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export function ModuleDial({ side }: { side: DialSide }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const routeIndex = moduleIndex(pathname);
  const onOverview = pathname === '/';

  const { w, h } = useViewport();
  const R = radiusFor(side, w, h);
  const g = useMemo(() => geometry(R), [R]);
  const idleScale = IDLE_EXTENT / (R + NOTCH);

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

  useLayoutEffect(() => paint(false), [paint, side, R]);
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
  const drag = useRef<{ last: number; moved: number; item: number | null; hub: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-i]');
    const hub = !!target.closest('[data-hub]');
    // Idle, a tap on the hub goes straight to the Overview without opening the dial.
    if (!hub || active) wake();
    drag.current = { last: angle(e), moved: 0, item: btn ? Number(btn.getAttribute('data-i')) : null, hub };
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
    if (d.moved >= 3) wake();
    paint(false);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved < 3) {
      if (d.hub) {
        // The hub opens the Overview.
        goTo(indexForRotation(rot.current), false);
        if (window.location.pathname !== '/') navigate('/');
        setActive(false);
        return;
      }
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
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate('/');
      return;
    }
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
  // On the Overview (or Settings) no module is lit until you start turning.
  const highlighted = active || routeIndex >= 0 ? current : -1;
  const hubLit = onOverview && !active;

  return (
    <>
      {/* Phones: while turning, blur the page behind the dial so they don't mix. A tap there puts the dial away. */}
      {bottom && (
        <div
          aria-hidden
          onClick={() => setActive(false)}
          className={`fixed inset-0 z-[35] bg-bg/60 backdrop-blur-xl transition-opacity duration-300 ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        />
      )}
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
                width: R * 2,
                height: R + NOTCH,
                marginLeft: -R,
                transformOrigin: 'bottom center',
                transform: `scale(${active ? 1 : idleScale})`,
              }
            : {
                left: 0,
                top: '50%',
                width: R + NOTCH,
                height: R * 2,
                marginTop: -R,
                transformOrigin: 'left center',
                transform: `scale(${active ? 1 : idleScale})`,
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
          style={{ width: R * 2, height: R * 2, ...(bottom ? { left: 0, top: NOTCH } : { left: -R, top: 0 }) }}
        >
          <svg viewBox={`0 0 ${R * 2} ${R * 2}`} className="pointer-events-none absolute inset-0 h-full w-full">
            {g.ticks}
          </svg>
          {MODULES.map((m, i) => (
            <button
              key={m.to}
              ref={(el) => (items.current[i] = el)}
              data-i={i}
              tabIndex={-1}
              aria-label={t(m.key)}
              className="absolute"
              style={{ width: g.item, height: g.item, ...place(i * STEP, side, R, g.itemR, g.item) }}
            >
              <span
                className={`flex h-full w-full items-center justify-center rounded-full border transition-colors ${
                  i === highlighted ? 'border-transparent bg-accent text-bg shadow-[0_0_0_6px_rgb(var(--accent)/0.12)]' : 'border-border bg-bg text-muted'
                }`}
              >
                <Icon name={m.icon} size={Math.round(g.item * 0.46)} />
              </span>
            </button>
          ))}
        </div>
        {/* Hub: the module's name while turning; a tap opens the Overview. */}
        <button
          data-hub
          tabIndex={-1}
          aria-label={t('nav.home')}
          className={`absolute flex flex-col items-center border text-center transition-colors ${
            hubLit ? 'border-transparent bg-accent text-bg' : 'border-border bg-bg text-fg hover:bg-card'
          }`}
          style={
            bottom
              ? {
                  left: '50%',
                  bottom: 0,
                  width: g.hub * 2,
                  height: g.hub,
                  marginLeft: -g.hub,
                  borderRadius: `${g.hub}px ${g.hub}px 0 0`,
                  borderBottom: 0,
                  justifyContent: 'flex-end',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                }
              : {
                  left: 0,
                  top: '50%',
                  width: g.hub,
                  height: g.hub * 2,
                  marginTop: -g.hub,
                  borderRadius: `0 ${g.hub}px ${g.hub}px 0`,
                  borderLeft: 0,
                  justifyContent: 'center',
                  paddingRight: 8,
                }
          }
        >
          {active ? (
            <>
              <b className="text-[15px] font-semibold leading-tight">{name}</b>
              <small className="mt-0.5 text-[11px] text-muted">{t('nav.tapForOverview')}</small>
            </>
          ) : (
            // Idle the dial is small: just the Overview icon.
            <Icon name="home" size={Math.round(g.hub * 0.55)} className={bottom ? 'mb-1' : ''} />
          )}
        </button>
      </div>
    </>
  );
}
