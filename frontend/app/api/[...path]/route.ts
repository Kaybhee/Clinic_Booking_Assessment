import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy to the booking API. It adds the secret X-API-Key on the server, so the
 * key never reaches the browser, and it only forwards the routes the page needs (no /reset).
 */
const ALLOWED: Array<[string, RegExp]> = [
  ['GET', /^slots$/],
  ['POST', /^bookings$/],
  ['GET', /^bookings$/],
  ['GET', /^bookings\/[^/]+$/],
  ['DELETE', /^bookings\/[^/]+$/],
];

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join('/');
  if (!ALLOWED.some(([method, re]) => method === req.method && re.test(joined))) {
    return NextResponse.json({ error: 'not_found', message: 'Route not found.' }, { status: 404 });
  }

  const base = process.env.BACKEND_URL;
  const key = process.env.API_KEY;
  if (!base || !key) {
    return NextResponse.json({ error: 'misconfigured', message: 'The booking service is not configured.' }, { status: 500 });
  }

  const headers: Record<string, string> = { 'X-API-Key': key };
  const idem = req.headers.get('idempotency-key');
  if (idem) headers['Idempotency-Key'] = idem;
  let body: string | undefined;
  if (req.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = await req.text();
  }

  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/${joined}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });
    const out = new NextResponse(await upstream.text(), { status: upstream.status });
    out.headers.set('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    const retry = upstream.headers.get('retry-after');
    if (retry) out.headers.set('Retry-After', retry);
    return out;
  } catch {
    return NextResponse.json({ error: 'unavailable', message: 'The booking service is not reachable right now.' }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as DELETE };
