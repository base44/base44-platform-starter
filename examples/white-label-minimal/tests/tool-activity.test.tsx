import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ToolActivity from "../components/ToolActivity";
import type { ToolCall } from "../lib/types";

function render(tool: ToolCall) {
  return renderToStaticMarkup(<ToolActivity tool={tool} />);
}

test("renders reviewed file, package, and plan activity as tool widgets", () => {
  const file = render({
    name: "write_file",
    status: "success",
    display_projection: { file_paths: ["src/App.tsx"] },
  });
  const packages = render({
    name: "install_npm_package",
    status: "success",
    arguments_string: JSON.stringify({ packages: [{ name: "zod", action: "install" }] }),
  });
  const plan = render({
    name: "update_plan",
    status: "success",
    arguments_string: JSON.stringify({ updates: [{ section_label: "Scope", text: "Add accounts" }] }),
    results: "Plan updated.",
  });
  assert.match(file, /src\/App.tsx/);
  assert.match(packages, /Install/);
  assert.match(packages, /zod/);
  assert.match(plan, /Scope/);
  assert.match(plan, /Add accounts/);
});

test("renders a reviewed generated-media result without raw prompt data", () => {
  const html = render({
    name: "generate_image",
    status: "success",
    arguments_string: JSON.stringify({ label: "Hero image", aspect_ratio: "16:9" }),
    results: {
      placeholder_url: "/__generating__/hero.png",
      status: "completed",
      image_url: "https://images.example/hero.png",
    },
  });
  assert.match(html, /Generated/);
  assert.match(html, /Hero image/);
  assert.match(html, /images.example/);
  assert.doesNotMatch(html, /prompt/);
});
