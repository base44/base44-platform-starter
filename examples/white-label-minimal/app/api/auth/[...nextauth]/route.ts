import * as classic from "../../../../server/auth";
import * as lean from "../../../../lean/server/auth";

export const { GET, POST } = process.env.TINY_SUNNY_LEAN === "true" ? lean.handlers : classic.handlers;
