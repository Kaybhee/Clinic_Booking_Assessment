export interface Slot {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}
export interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}
export interface BookingPage {
  bookings: Booking[];
  next_cursor: string | null;
}

/** The API answers errors as { "error": "<message>" }; `status` tells the page what kind. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { ...init, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retry = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'Something went wrong.', retry > 0 ? retry : undefined);
  }
  return data as T;
}

export const api = {
  slots: () => call<{ slots: Slot[] }>('slots').then((r) => r.slots),
  book: (body: { slot_id: string; name: string; email: string }, idempotencyKey: string) =>
    call<Booking>('bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  booking: (id: string) => call<Booking>(`bookings/${encodeURIComponent(id)}`),
  cancel: (id: string) => call<Booking>(`bookings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  list: (email: string, cursor?: string | null) =>
    call<BookingPage>(`bookings?email=${encodeURIComponent(email)}&limit=5${cursor ? `&cursor=${cursor}` : ''}`),
};
