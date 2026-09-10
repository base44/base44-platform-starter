import { createHandler } from '../../../lib/api-handler';
import { getWorkspaceClient } from '../../../lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const POST = createHandler(getWorkspaceClient);
