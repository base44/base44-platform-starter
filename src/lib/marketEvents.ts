/**
 * Tells any open market surface that the catalogue changed.
 *
 * The builder is a panel over whatever page you were on, so publishing from the chat
 * leaves the market grid behind it stale. Same shape as `widgets-updated`. Announced
 * from `PublishDialog` and from install/uninstall, so new callers get it for free.
 */
import { useEffect, useRef } from "react";

export const MARKET_CHANGED = "market-changed";

export function announceMarketChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MARKET_CHANGED));
}

/** Ref-held so an inline arrow does not rebind, and miss an event, every render. */
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
