/**
 * Route for the Board page (src/views/Board.jsx).
 *
 * The board id comes from `?id=`, so this route reads `useSearchParams()`, which
 * forces client rendering — the Suspense boundary is required rather than
 * optional: without it the build fails on this route.
 */
"use client";

import { Suspense } from "react";

import BoardPage from "@/views/Board";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <BoardPage />
    </Suspense>
  );
}
