import { NextRequest } from 'next/server';
import { POST as link } from '@/app/api/base44/link/route';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowed = process.env.BUILDER_ORIGIN || new URL(request.url).origin;
  if (origin !== allowed) return Response.json({ error: 'This request origin is not allowed.' }, { status: 403 });
  return link(request);
}
