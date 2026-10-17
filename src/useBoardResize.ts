import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const preferenceKey = 'review-board-size-v1';
function savedSize() {
  try { const value = Number(localStorage.getItem(preferenceKey)); return Number.isFinite(value) && value >= 120 && value <= 4000 ? value : null; }
  catch { return null; }
}
export function useBoardResize() {
  const workspace = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [initialSize] = useState(savedSize);
  const desired = useRef<number | null>(initialSize);
  const drag = useRef<{ x: number; y: number; width: number; previous: number | null } | null>(null);
  const [bounds, setBounds] = useState({ min: 220, max: 1000, value: 600 });
  const [resizing, setResizing] = useState(false);
  const measure = () => {
    const host = workspace.current;
    if (!host) return;
    const gap = parseFloat(getComputedStyle(host).columnGap) || 10;
    const max = Math.max(120, Math.floor(Math.min(host.clientWidth - 280 - gap, host.clientHeight - (footer.current?.offsetHeight || 65) - 8)));
    const min = Math.min(320, max);
    const value = Math.round(Math.min(max, Math.max(min, desired.current ?? Math.min(max, host.clientWidth * .64))));
    host.style.setProperty('--review-board-size', `${value}px`);
    setBounds(current => current.min === min && current.max === max && current.value === value ? current : { min, max, value });
    return value;
  };
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    if (workspace.current) observer.observe(workspace.current);
    if (footer.current) observer.observe(footer.current);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const save = () => { try { if (desired.current === null) localStorage.removeItem(preferenceKey); else localStorage.setItem(preferenceKey, String(desired.current)); } catch { /* Storage may be unavailable. */ } };
  return {
    workspace, board, footer, resizing,
    handle: {
      role: 'slider' as const, 'aria-label': 'Resize board', 'aria-valuemin': bounds.min, 'aria-valuemax': bounds.max, 'aria-valuenow': bounds.value, 'aria-valuetext': `${bounds.value} pixels`, 'aria-orientation': 'horizontal' as const,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, width: board.current?.getBoundingClientRect().width || bounds.value, previous: desired.current };
        setResizing(true);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        if (!drag.current) return;
        desired.current = drag.current.width + (event.clientX - drag.current.x + event.clientY - drag.current.y) / 2;
        measure();
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        if (!drag.current) return;
        desired.current = measure() ?? desired.current; drag.current = null; setResizing(false); save();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: () => { if (drag.current) desired.current = drag.current.previous; drag.current = null; setResizing(false); measure(); },
      onLostPointerCapture: () => { if (!drag.current) return; desired.current = drag.current.previous; drag.current = null; setResizing(false); measure(); },
      onDoubleClick: () => { desired.current = null; measure(); save(); },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
        if (!direction && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        desired.current = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : bounds.value + direction * (event.shiftKey ? 40 : 16);
        desired.current = measure() ?? desired.current; save();
      },
    },
  };
}
