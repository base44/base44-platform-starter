"use client";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";

// assistant-ui's MarkdownText, without code highlighting.
export function MarkdownText() {
  return (
    <MarkdownTextPrimitive className="[&_h1,&_h2,&_h3]:my-2 [&_h1,&_h2,&_h3]:font-semibold [&_ol]:list-decimal [&_ol,&_ul]:pl-5 [&_p]:my-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc" />
  );
}
