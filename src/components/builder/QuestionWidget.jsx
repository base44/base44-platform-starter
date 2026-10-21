import ApprovalWidget from "./widgets/ApprovalWidget";
import SecretsWidget from "./widgets/SecretsWidget";
import ClarifyingQuestionsWidget from "./widgets/ClarifyingQuestionsWidget";

/**
 * Renders an open question by `kind`, one of the three `useChat` knows
 * (`"choice" | "secrets" | "approval"`). The hook declines a kind it doesn't
 * know, so it never reaches here.
 */
export default function QuestionWidget({ step, question }) {
  if (question.kind === "approval") return <ApprovalWidget step={step} question={question} />;
  if (question.kind === "secrets") return <SecretsWidget step={step} question={question} />;
  return <ClarifyingQuestionsWidget step={step} question={question} />;
}
