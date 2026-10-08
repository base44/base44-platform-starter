import type { Base44ChatServer } from "../../../sdk";
import { createApp, openLiveSession, sendMessage, submitToolCallInput } from "../../../server/base44";

// The library calls Base44 through Tiny's server.
export const server: Base44ChatServer = { createApp, openLiveSession, sendMessage, submitToolCallInput };
