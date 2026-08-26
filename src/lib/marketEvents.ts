/**
 * Tells any open market surface that the catalogue changed.
 *
 * The builder is a side panel over whatever page you were on, so you can publish an
 * app from the chat while looking straight at the market grid behind it — and the grid
 * has no reason to refetch. Same for installing from one surface with another mounted.
 * Without a signal the only fix is a manual reload, which reads as "it didn't work".
 *
 * Same shape as `widgets-updated` and `app-rebuilt`, deliberately: this codebase
 * already coordinates cross-surface refreshes with window events, and a third
 * mechanism would be a third thing to remember.
 *
 * Announced from the one place every publish goes through (`PublishDialog`) and from
 * install/uninstall, so a new caller gets it for free rather than having to remember.
 */
import { useEffect, useRef } from "react";

export const MARKET_CHANGED = "market-changed";

export function announceMarketChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MARKET_CHANGED));
}

/**
 * Run `onChange` whenever the catalogue changes.
 *
 * Kept in a ref so a caller passing an inline arrow does not rebind — and miss an
 * announcement — on every render.
 */
export function useMarketChanges(onChange: () => void): void {
  const handler = useRefLatest(onChange);
  useEffect(() => {
    const fire = () => handler.current();
    window.addEventListener(MARKET_CHANGED, fire);
    return () => window.removeEventListener(MARKET_CHANGED, fire);
  }, [handler]);
}

function useRefLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
