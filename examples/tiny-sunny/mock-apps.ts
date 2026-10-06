import type { App } from "./types";

// Local stand-ins until the apps come from Base44.
function page(title: string, color: string, body: string) {
  return `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#f6f7f9">
<header style="padding:20px 24px;background:${color};color:white;font-size:20px;font-weight:600">${title}</header>
<main style="padding:24px">${body}</main></body></html>`;
}

export const mockApps: App[] = [
  {
    id: "habit-tracker",
    name: "Habit Tracker",
    html: page("Habit Tracker", "#e8492c", "<p>Drink water ✅</p><p>Read 20 minutes ⬜</p><p>Walk ✅</p>"),
  },
  {
    id: "team-standup",
    name: "Team Standup",
    html: page("Team Standup", "#17a2bd", "<p><b>Dana</b> — shipping the board view</p><p><b>Lior</b> — fixing sign-in</p>"),
  },
  {
    id: "recipe-box",
    name: "Recipe Box",
    html: page("Recipe Box", "#8aa12a", "<p>Shakshuka</p><p>Lemon pasta</p><p>Miso soup</p>"),
  },
];
