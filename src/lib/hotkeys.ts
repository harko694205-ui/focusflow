import { useEffect, useRef } from 'react';

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Hotkey spec: "x", "shift+d", "mod+d" (Ctrl on Windows/Linux, ⌘ on macOS), "arrowdown", "delete", "/", "?".
 * Keys are matched against KeyboardEvent.key (lower-cased).
 */
export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function matches(spec: string, e: KeyboardEvent): boolean {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop()!;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const mod = e.metaKey || e.ctrlKey;
  if (mod !== wantMod || e.altKey !== wantAlt) return false;
  // Shift is implied for symbols like "?" — only enforce it when explicitly requested.
  if (wantShift && !e.shiftKey) return false;
  // Unrequested Shift rejects the match — except for symbols that need Shift to type ("?", "!").
  const shiftedSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (!wantShift && e.shiftKey && !shiftedSymbol) return false;
  return e.key.toLowerCase() === key;
}

/**
 * Register page-level shortcuts. Ignored while typing in a field, or when `enabled()` returns false
 * (e.g. a dialog is open). The handler map may change every render; only the latest is used.
 */
export function useHotkeys(map: HotkeyMap, enabled: () => boolean = () => true) {
  const ref = useRef({ map, enabled });
  ref.current = { map, enabled };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || !ref.current.enabled()) return;
      for (const [spec, fn] of Object.entries(ref.current.map)) {
        if (matches(spec, e)) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
