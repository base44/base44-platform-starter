// A copy of packages/platform/src/react from base44/javascript-sdk#314 (option B),
// until @base44/platform/react is published. Replace this folder with that import then.
/** The `@base44/platform/react` entry: one app's builder chat as a hook, and a provider with parts you replace. React is an optional peer, loaded only here. */
export { useBase44Chat } from "./useBase44Chat";
export { Base44ChatProvider } from "./Base44ChatProvider";
export { useChatActions, useChatComponents, useChatState } from "./context";
export { Message, Question } from "./Message";
export type {
  ApprovalQuestion, Base44App, Base44Chat, Base44ChatOptions, Base44ChatServer, ChatError, ChatItem, ChatPhase, ChatStep,
  ChoiceEntry, ChoiceQuestion, InputField, InputQuestion, LiveSession, Question as ChatQuestion, ToolCallAnswer, UnknownQuestion,
} from "./chat.types";
export type {
  Base44ChatProviderProps, ChatActions, ChatComponentOverrides, ChatComponents, ChatState, MessageComponents, MessageProps,
  QuestionComponents, QuestionProps, StepProps, TextProps,
} from "./components.types";
