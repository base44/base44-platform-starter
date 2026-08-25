import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The RLS rule from src/lib/rls.ts, mechanized: Prisma's by-id `update`/`delete`
 * take a *unique* `where` that cannot carry `createdBy`, so on an owner-scoped
 * model they silently write another user's row. Every such write must go through
 * `updateMany`/`deleteMany` with `scopedWhere()` and a `count` check — see
 * `src/lib/entityCrud.ts`.
 *
 * `User` is not restricted: it is not owner-scoped (it has no `createdBy`).
 */
const ownerScopedByIdWrites = {
  selector:
    "CallExpression[callee.object.object.name='prisma']" +
    "[callee.object.property.name=/^(team|board|item|widget|appOwnership)$/]" +
    "[callee.property.name=/^(update|delete)$/]",
  message:
    "By-id update/delete cannot carry the RLS predicate — use updateMany/deleteMany " +
    "with scopedWhere() and check the returned count. See src/lib/rls.ts.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `_foo` marks a parameter that exists to document a signature but is not
    // read — deliberate, so it is not an error.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    // rls-smoke.ts calls the by-id form on purpose, to demonstrate the trap.
    ignores: ["scripts/rls-smoke.ts"],
    rules: { "no-restricted-syntax": ["error", ownerScopedByIdWrites] },
  },
  {
    /**
     * The Sunny product UI: ~13k lines of working React written for React 18,
     * without the compiler. It is the *example* app, not the part of this repo
     * worth studying, so the stylistic rules are off *for this tree only* — the
     * platform infrastructure in src/lib and src/app stays fully linted,
     * including the RLS rule above.
     *
     * Each of these is cosmetic or a false positive on this code, never a
     * correctness rule:
     */
    files: ["src/components/**/*.jsx", "src/views/**/*.jsx", "src/lib/{appName,boardColor}.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      // Apostrophes in copy: "Let's", "you're". Renders correctly.
      "react/no-unescaped-entities": "off",
      // <img> for user-supplied board/app art of unknown dimensions; next/image
      // needs a known size or a configured remote host.
      "@next/next/no-img-element": "off",
      // These components load data in an effect with a [] dep list on purpose.
      // Converting them to server components is future work.
      "react-hooks/exhaustive-deps": "warn",
      /**
       * React Compiler diagnostics, new in eslint-config-next 16. This code was
       * written for React 18 without the compiler and trips them wholesale:
       * setState in effects, refs read during render, use-before-declare among
       * hoisted consts. It runs correctly — the cost is that these components
       * opt out of compiler memoization.
       */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/error-boundaries": "off",
      // Flags e.g. Date.now()/Math.random() read during render for widget ids.
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
