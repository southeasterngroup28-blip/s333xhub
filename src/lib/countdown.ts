import { useEffect, useState } from 'react';

/** "02:14:09" (or "3d 02:14:09") until a moment; empty when it's past. */
export function countdownTo(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** Ticking clock for countdown screens. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
