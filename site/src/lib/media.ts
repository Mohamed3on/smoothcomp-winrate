import { useSyncExternalStore } from 'react';

// Whether a media query matches, kept current as the window resizes.
export const useMedia = (query: string) => useSyncExternalStore(
  (change) => { const m = matchMedia(query); m.addEventListener('change', change); return () => m.removeEventListener('change', change); },
  () => matchMedia(query).matches,
);
