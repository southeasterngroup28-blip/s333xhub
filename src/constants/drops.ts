// When a new drop's countdown ends, as the artist's form offers it.
// drop-edit prepends its own 'KEEP AS SET' (hours 0) entry.
export const DROP_WHEN_OPTIONS = [
  { label: 'IN 1 HOUR', hours: 1 },
  { label: 'IN 6 HOURS', hours: 6 },
  { label: 'IN 24 HOURS', hours: 24 },
  { label: 'IN 3 DAYS', hours: 72 },
  { label: 'IN 7 DAYS', hours: 168 },
] as const;
