import ApprovalWidget from "./widgets/ApprovalWidget";
import SecretsWidget from "./widgets/SecretsWidget";
import ClarifyingQuestionsWidget from "./widgets/ClarifyingQuestionsWidget";

/**
 * Route an interrupt to a widget by its normalized `waiting_on.kind`, so a new
 * interrupt tool needs no per-name entry here. The platform emits the kind for
 * the whole interrupt lifecycle and it is one of three values
 * (`WaitingKind = "choice" | "input" | "approval"`), which is the entire
 * contract this file depends on.
 *
 * Anything without a kind is not an interrupt, and falls through to the generic
 * ToolCallDisplay row — right for read-only tool calls.
 */
const KIND_WIDGETS = {
  approval: ApprovalWidget,
  input: SecretsWidget,
  choice: ClarifyingQuestionsWidget,
};

export function widgetFor(toolCall) {
  return KIND_WIDGETS[toolCall?.waiting_on?.kind] ?? null;
}
