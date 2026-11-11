'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, Booking, Slot } from '@/lib/api';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const range = (s: Slot) => `${timeFmt.format(new Date(s.start))} to ${timeFmt.format(new Date(s.end))}`;
const when = (s: Slot) => `${dayFmt.format(new Date(s.start))}, ${range(s)}`;

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return `Too many attempts for this email. Try again in ${err.retryAfter ?? 60} seconds.`;
    if (err.status === 409 && err.message === 'slot already booked') return 'Someone just booked that time. Pick another one.';
    if (err.message === 'slot has already started') return 'That time has already started. Pick a later one.';
    if (err.status === 401 || err.status === 500) return 'The booking service is unavailable right now. Please try again shortly.';
    return err.message.charAt(0).toUpperCase() + err.message.slice(1) + '.';
  }
  return 'Something went wrong. Please try again.';
}

export default function Page() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('all');
  const [selected, setSelected] = useState<Slot | null>(null);
  const [confirmation, setConfirmation] = useState<Booking | null>(null);
  // Lets the 'your bookings' list follow along when something is booked or cancelled above it.
  const [lastBooking, setLastBooking] = useState<Booking | null>(null);
  const [version, setVersion] = useState(0);

  const loadSlots = useCallback(async () => {
    try {
      setSlots(await api.slots());
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);
  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const providers = useMemo(() => Array.from(new Set((slots ?? []).map((s) => s.provider))).sort(), [slots]);
  const days = useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      if (new Date(s.start).getTime() <= now) continue;
      if (provider !== 'all' && s.provider !== provider) continue;
      const k = dayKey(s.start);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return Array.from(groups.values());
  }, [slots, provider]);

  const slotById = useMemo(() => new Map((slots ?? []).map((s) => [s.id, s])), [slots]);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Book an appointment</h1>
        <p>Pick an open time, tell us who you are, and you will get a booking reference straight away.</p>
      </header>

      <div className="layout">
        <section aria-labelledby="times-heading" className="times">
          <div className="times-head">
            <h2 id="times-heading">Open times</h2>
            <div className="chips" role="group" aria-label="Filter by doctor">
              {['all', ...providers].map((p) => (
                <button key={p} className="chip" aria-pressed={provider === p} onClick={() => setProvider(p)}>
                  {p === 'all' ? 'All doctors' : p}
                </button>
              ))}
            </div>
          </div>

          {loadError && (
            <p className="notice error" role="alert">
              {loadError} <button className="link" onClick={loadSlots}>Try again</button>
            </p>
          )}
          {!slots && !loadError && <p className="muted">Loading open times…</p>}
          {slots && slots.length === 0 && (
            <p className="muted">The clinic has not published any appointment times yet. Please check back soon.</p>
          )}
          {slots && slots.length > 0 && days.length === 0 && (
            <p className="muted">No upcoming times{provider !== 'all' ? ` for ${provider}` : ''} right now. Try another doctor, or check back soon.</p>
          )}

          {days.map((list) => (
            <div className="day" key={dayKey(list[0].start)}>
              <h3>{dayFmt.format(new Date(list[0].start))}</h3>
              <ul className="slot-grid">
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      className="slot"
                      disabled={!s.available}
                      aria-pressed={selected?.id === s.id}
                      onClick={() => {
                        setConfirmation(null);
                        setSelected(s);
                      }}
                    >
                      <span className="slot-time">{timeFmt.format(new Date(s.start))}</span>
                      <span className="slot-meta">{s.available ? s.provider : `${s.provider}, taken`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <aside className="panel" aria-live="polite">
          {confirmation ? (
            <Confirmation
              booking={confirmation}
              slot={slotById.get(confirmation.slot_id)}
              onAnother={() => {
                setConfirmation(null);
                setSelected(null);
              }}
              onCancelled={() => {
                setVersion((v) => v + 1);
                loadSlots();
              }}
            />
          ) : selected ? (
            <BookingForm
              key={selected.id}
              slot={selected}
              onCancel={() => setSelected(null)}
              onBooked={(b) => {
                setConfirmation(b);
                setLastBooking(b);
                setSelected(null);
                loadSlots();
              }}
              onTaken={() => {
                setSelected(null);
                loadSlots();
              }}
            />
          ) : (
            <div>
              <h2>Your appointment</h2>
              <ol className="steps">
                <li>Pick a green time</li>
                <li>Enter your name and email</li>
                <li>Get your booking reference</li>
              </ol>
            </div>
          )}
        </aside>
      </div>

      <MyBookings slotById={slotById} onChanged={loadSlots} lastBooking={lastBooking} version={version} />
    </main>
  );
}

function BookingForm({ slot, onBooked, onCancel, onTaken }: { slot: Slot; onBooked: (b: Booking) => void; onCancel: () => void; onTaken: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: if the request is retried (double click, flaky network), the server
  // returns the same booking instead of creating a second one.
  const key = useRef(crypto.randomUUID());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onBooked(await api.book({ slot_id: slot.id, name, email }, key.current));
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && (err.message === 'slot already booked' || err.message === 'slot has already started')) setTimeout(onTaken, 1800);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2>Confirm your details</h2>
      <p className="picked">
        <strong>{slot.provider}</strong>
        <br />
        {when(slot)}
      </p>
      <label>
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || !name.trim() || !email.trim()}>
          {busy ? 'Booking…' : 'Book this time'}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Choose another time
        </button>
      </div>
    </form>
  );
}

function Confirmation({ booking, slot, onAnother, onCancelled }: { booking: Booking; slot?: Slot; onAnother: () => void; onCancelled: () => void }) {
  const [status, setStatus] = useState(booking.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm('Cancel this appointment?')) return;
    setBusy(true);
    setError(null);
    try {
      setStatus((await api.cancel(booking.id)).status);
      onCancelled();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirmation">
      <h2>{status === 'confirmed' ? 'You are booked' : 'Appointment cancelled'}</h2>
      {slot && (
        <p className="picked">
          <strong>{slot.provider}</strong>
          <br />
          {when(slot)}
        </p>
      )}
      <dl>
        <dt>Name</dt>
        <dd>{booking.name}</dd>
        <dt>Email</dt>
        <dd>{booking.email}</dd>
        <dt>Booking reference</dt>
        <dd className="ref">{booking.id}</dd>
      </dl>
      {status === 'confirmed' && <p className="muted">Keep this reference. It also appears under "Your bookings" below.</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={onAnother}>
          Book another time
        </button>
        {status === 'confirmed' && (
          <button className="ghost danger" onClick={cancel} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel this appointment'}
          </button>
        )}
      </div>
    </div>
  );
}

const EMAIL_KEY = 'clinic-booking-email';
const readStoredEmail = () => {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
};
const storeEmail = (v: string) => {
  try {
    window.localStorage.setItem(EMAIL_KEY, v);
  } catch {
    /* private mode: the page works without it */
  }
};

function MyBookings({ slotById, onChanged, lastBooking, version }: { slotById: Map<string, Slot>; onChanged: () => void; lastBooking: Booking | null; version: number }) {
  const [email, setEmail] = useState('');
  const [items, setItems] = useState<Booking[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ref, setRef] = useState('');
  const [found, setFound] = useState<Booking | null>(null);
  const [refError, setRefError] = useState<string | null>(null);

  const load = useCallback(async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const page = await api.list(address);
      setItems(page.bookings);
      setCursor(page.next_cursor);
      setSearched(address.trim().toLowerCase());
      storeEmail(address.trim());
    } catch (err) {
      setItems(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Returning visitor: remember the last email used and show their bookings straight away.
  useEffect(() => {
    const stored = readStoredEmail();
    if (stored) {
      setEmail(stored);
      load(stored);
    }
  }, [load]);

  // Something was just booked (or cancelled) above: show it here without any extra clicks.
  useEffect(() => {
    if (lastBooking) {
      setEmail(lastBooking.email);
      load(lastBooking.email);
    }
  }, [lastBooking, version, load]);

  function findByEmail(e: FormEvent) {
    e.preventDefault();
    load(email);
  }

  async function more() {
    setBusy(true);
    try {
      const page = await api.list(searched, cursor);
      setItems((cur) => [...(cur ?? []), ...page.bookings]);
      setCursor(page.next_cursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function findByRef(e: FormEvent) {
    e.preventDefault();
    setRefError(null);
    setFound(null);
    try {
      setFound(await api.booking(ref.trim()));
    } catch (err) {
      setRefError(err instanceof ApiError && err.status === 404 ? 'No booking has that reference.' : errorText(err));
    }
  }

  async function cancel(b: Booking, after: (updated: Booking) => void) {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      after(await api.cancel(b.id));
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const row = (b: Booking, after: (u: Booking) => void) => {
    const s = slotById.get(b.slot_id);
    return (
      <li key={b.id} className="row">
        <div>
          <strong>{s ? s.provider : 'Appointment'}</strong>
          <div className="muted">{s ? when(s) : `Slot ${b.slot_id}`}</div>
          <div className="ref small">{b.id}</div>
        </div>
        {b.status === 'confirmed' ? (
          <button className="ghost danger" onClick={() => cancel(b, after)}>
            Cancel
          </button>
        ) : (
          <span className="badge">Cancelled</span>
        )}
      </li>
    );
  };

  return (
    <section className="lookup" aria-labelledby="mine-heading">
      <h2 id="mine-heading">Your bookings</h2>
      <p className="muted lookup-intro">Bookings you make appear here automatically. Booked before, or on another device? Enter your email.</p>
      <div className="lookup-grid">
        <form onSubmit={findByEmail}>
          <label>
            Your email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <button className="primary" disabled={busy || !email.trim()}>
            {busy ? 'Looking…' : 'Show my bookings'}
          </button>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {items && items.length === 0 && <p className="muted empty">No bookings for {searched} yet. Pick a time above to make your first one.</p>}
          {items && items.length > 0 && (
            <ul className="rows">{items.map((b) => row(b, (u) => setItems((cur) => (cur ?? []).map((x) => (x.id === u.id ? u : x)))))}</ul>
          )}
          {cursor && (
            <button type="button" className="ghost" onClick={more} disabled={busy}>
              Load more
            </button>
          )}
        </form>

        <form onSubmit={findByRef}>
          <label>
            Have a booking reference instead?
            <input value={ref} onChange={(e) => setRef(e.target.value)} required spellCheck={false} placeholder="Paste it here" />
          </label>
          <button className="primary" disabled={!ref.trim()}>
            Look up booking
          </button>
          {refError && (
            <p className="notice error" role="alert">
              {refError}
            </p>
          )}
          {found && <ul className="rows">{row(found, setFound)}</ul>}
        </form>
      </div>
    </section>
  );
}
