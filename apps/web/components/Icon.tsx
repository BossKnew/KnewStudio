import type { ReactNode } from 'react';

export type IconName = 'plus' | 'image' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'edit' | 'check' | 'close' | 'history' | 'play' | 'users' | 'group' | 'chart' | 'server' | 'layers' | 'text' | 'sparkles' | 'shield' | 'sliders' | 'globe' | 'note' | 'delete' | 'share' | 'reference' | 'unshare';

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="M13.5 6.5l4 4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
  play: <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  group: <><circle cx="8" cy="8" r="3.5" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9.5" r="2.5" /><path d="M15 15.5a5.5 5.5 0 0 1 6.5 4.5" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-6M21 20H3" />,
  server: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  layers: <><path d="m12 2 10 6-10 6L2 8Z" /><path d="m2 14 10 6 10-6" /></>,
  text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  sparkles: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" /><path d="M19 3v4M21 5h-4" /></>,
  shield: <path d="M12 3l7 3v5c0 4.6-3 8.6-7 10-4-1.4-7-5.4-7-10V6Z" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" /></>,
  note: <><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></>,
  delete: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" /></>,
  reference: <><path d="M4 7h10M4 12h16M4 17h10" /><path d="m14 7 6-3v6Z" /></>,
  unshare: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><path d="M8.6 10.5 15.4 6.5M5 19 19 5" /></>,
};

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={'icon' + (className ? ' ' + className : '')} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}
