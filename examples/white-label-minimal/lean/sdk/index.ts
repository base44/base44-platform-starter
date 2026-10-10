// A copy of packages/platform/src/react from base44/javascript-sdk#315 (option A),
// until @base44/platform/react is published. Replace this folder with that import then.
/** The `@base44/platform/react` entry: one app's builder chat as a hook. React is an optional peer, loaded only here. */
export { useBase44Chat } from "./useBase44Chat";
export type {
  ApprovalQuestion, Base44App, Base44Chat, Base44ChatOptions, Base44ChatServer, ChatError, ChatItem, ChatPhase, ChatStep,
  ChoiceEntry, ChoiceQuestion, InputField, InputQuestion, LiveSession, Question, ToolCallAnswer, UnknownQuestion,
} from "./chat.types";
