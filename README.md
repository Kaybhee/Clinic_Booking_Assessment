# Clinic booking: API + web page
### Brief DIY
- `backend/`: NestJS + MongoDB (Mongoose), built on the provided starter template (config, repository layer, exceptions, filters).
- `frontend/`: lightweight Next.js page (see open times, book, confirmation, find/cancel bookings).

## Endpoints (all need `X-API-Key`, except `/health` and `/docs`)

| Method | Path | Level | Result |
| --- | --- | --- | --- |
| POST | `/reset` | 1 | `{ "slots": [{id, provider, start, end}] }` deletes every booking, replaces all slots, 200 |
| GET | `/slots?provider=` | 1 | `{ "slots": [...] }` earliest first, each with `available`, 200 |
| POST | `/bookings` | 1-5 | `{ slot_id, name, email }` creates a booking, 201 |
| GET | `/bookings/:id` | 1 | the booking, 200 / 404 |
| DELETE | `/bookings/:id` | 3 | cancels and frees the slot, 200 / 404 / 409 |
| GET | `/bookings?email=&limit=&cursor=` | 4 | `{ bookings, next_cursor }`, oldest first; limit 1 to 50 (default 10), else 400 |

Errors are always `{ "error": "<message>" }`, as in the assessment contract.
Status codes: 400 invalid body or slot already started, 401 bad key, 404 unknown slot/booking, 409 slot taken or already cancelled, 422 idempotency key reused with a different body, 429 rate limited (with `Retry-After`).

## How each level works

1. **Core**: slots and bookings live in MongoDB. `available` is computed from confirmed bookings, never stored. Slot times are echoed back exactly as sent to `/reset`.
2. **Key + validation**: an Express middleware runs before the body parser and compares `X-API-Key` in constant time (401 first, whatever the body). Names and emails are trimmed, emails lower-cased and checked.
3. **No double booking**: a partial unique index, `unique(slotId) where status = 'confirmed'`. Two simultaneous requests can both see the slot free, but only one insert commits; the loser gets a duplicate-key error that becomes 409. Cancelling flips status, so the slot drops out of the index and can be booked again. Cancelling is a single conditional update, so two simultaneous cancels cannot both succeed.
4. **Retries + paging**: the first request with an `Idempotency-Key` claims it (key = unique `_id`); a retry replays the stored response, simultaneous retries wait for the first, and the same key with another body is 422. Failed attempts release the key. Paging is keyset on `_id` (stable, no skipped or repeated rows).
5. **Spam**: 5 attempts per email per 60 s (sliding window), failed attempts included (so the 6th is 429 even if it would have been a 400 or 404), recorded with one atomic update on one document, stored in MongoDB so it holds across instances. Replays of an idempotent request do not count.

## Run locally

```bash
# API
cd backend && cp .env.example .env   # set API_KEY and MONGODB_URI
npm install && npm run start:dev

# Web (new terminal)
cd frontend && cp .env.example .env.local   # BACKEND_URL + the same API_KEY
npm install && npm run dev                  # http://localhost:3001
```

Tests (need a local MongoDB; set `TEST_MONGODB_URI` to use another one): `cd backend && npm run test:e2e`

## Deploy

1. **Database**: create a free MongoDB Atlas cluster, allow network access from anywhere (or Render's IPs), copy the connection string.
2. **API on Render**: New > Blueprint > pick this repo (uses `render.yaml`), paste `MONGODB_URI`. Render generates `API_KEY`; copy it. Health check is `/health`.
3. **Web on Vercel**: import the repo, set the root directory to `frontend`, and add env vars `BACKEND_URL` (the Render URL) and `API_KEY`. The browser only talks to `/api/*` on the Vercel site; that route adds the key on the server, so the key is never shipped to the browser and `/reset` is not reachable from the page.

Submit the Render URL as the API base URL and the Vercel URL as the web page.
