import { createHandler } from "../../../../lib/server/api-handler";
import { getAppClient } from "../../../../lib/server/app-service";

export const runtime = "nodejs";
export const POST = createHandler(getAppClient, ["getBuilderConnection"]);
