"use client";

import { createContext, useContext } from "react";

export const BuilderPanelContext = createContext(null);

export function useBuilderPanel() {
  const panel = useContext(BuilderPanelContext);
  if (!panel) throw new Error("BuilderPanelContext is missing");
  return panel;
}
