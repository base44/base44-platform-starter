import { createHandler } from '../../../lib/api-handler';
import { getAppClient } from '../../../lib/app-service';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const POST = createHandler(getAppClient);
