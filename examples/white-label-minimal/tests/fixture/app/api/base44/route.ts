import { createHandler } from '../../../../../lib/api-handler';
import { Base44Error } from '../../../../../lib/base44-error';
export const POST = createHandler(async () => { throw new Base44Error('Sign in to continue.', 401); });
