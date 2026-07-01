# USSD

This document covers the USSD feature — how it works, the full menu tree, the Africa's Talking integration, how to test it locally using ngrok and the AT sandbox simulator, and the NGO admin workflow for managing callback requests.

---

## Overview

The USSD channel lets anyone with a basic mobile phone access the platform without internet or a smartphone. Users dial a shortcode, navigate a simple menu, and can either request a callback from the support team or retrieve emergency contact numbers.

USSD is intentionally minimal — no account, no login, no internet required. It is the lowest-barrier entry point to the platform, designed for users in crisis who may only have a feature phone.

**Shortcode (sandbox):** `*384*183523#`

---

## How USSD Works with Africa's Talking

When a user dials the shortcode, Africa's Talking initiates a USSD session and immediately POSTs to the configured callback URL. Every subsequent menu selection by the user triggers another POST. The server reads the accumulated input and returns a plain-text response.

There are two response types AT understands:

| Prefix | Meaning |
|--------|---------|
| `CON ` | **Continue** — display the text and wait for another user input. Session stays open. |
| `END ` | **End** — display the text and terminate the session. No further input expected. |

AT does not accept JSON. Every response from `/api/ussd/callback` must be `Content-Type: text/plain` starting with either `CON ` or `END `.

### The `text` field

AT sends a `text` field in every POST body that represents the full accumulated input for the session, with each selection separated by `*`.

| User action | `text` value AT sends |
|-------------|----------------------|
| First dial (no input yet) | `""` (empty string) |
| Pressed `1` | `"1"` |
| Pressed `1`, then `1` | `"1*1"` |
| Pressed `1`, then `0` | `"1*0"` |
| Pressed `2` | `"2"` |

The server parses this into an ordered array of steps (`parseMenuPath`) and uses it to determine which menu level the user is at.

### Fields AT sends on every POST

| Field | Description |
|-------|-------------|
| `sessionId` | Unique ID for this USSD session. Stable for the lifetime of one dial. |
| `phoneNumber` | The caller's phone number in E.164 format. |
| `text` | Accumulated user input, `*`-delimited. Empty string on first interaction. |
| `serviceCode` | The shortcode that was dialled. |
| `networkCode` | The mobile network operator code. |

---

## Menu Tree

```
[Dial shortcode]
│
└── CON Welcome to GBV Support
    │   1. Request a callback
    │   2. Emergency contacts
    │
    ├── 1 ──► CON Confirm callback request
    │         We will contact you on <phoneNumber>
    │         1. Confirm
    │         0. Cancel
    │
    │         ├── 1 ──► [Save UssdCallbackRequest to DB]
    │         │         END Your callback request has been received.
    │         │             Our support team will contact you shortly.
    │         │
    │         ├── 0 ──► END Request cancelled. You can dial again any time.
    │         │
    │         └── other ──► END Invalid selection. Please dial again.
    │
    ├── 2 ──► END Emergency contacts:
    │             Police: 999 or 112
    │             Childline Kenya: 116
    │             National GBV Hotline: 1195
    │
    └── other ──► END Invalid selection. Please dial again.
```

### Design decisions

- **No account required.** The callback request saves only the caller's phone number. Users do not need to be registered on the platform.
- **Confirmation step before saving.** Pressing `1` does not immediately submit — the user is shown their phone number and asked to confirm. This prevents accidental requests and gives the user a clear moment to cancel.
- **Emergency contacts are a dead end (END).** They display immediately without further input because a user in crisis should not have to navigate further.
- **Unrecognised inputs end the session gracefully.** Rather than looping, the session ends with a clear message so the user knows to dial again.

---

## Backend Implementation

### Endpoint

`POST /api/ussd/callback` — mounted at `/api/ussd` in `ussdRoutes.js`.

This endpoint is **public** (no `authMiddleware`). Africa's Talking does not sign USSD requests, so there is no token or signature to verify. In production, an IP allowlist at the reverse-proxy level (restricting to AT's IP ranges) is recommended.

### Controller (`backend/src/controllers/ussdController.js`)

**`parseMenuPath(rawText)`**
Splits the AT `text` field on `*` and trims each segment. Returns an empty array when `text` is empty (first interaction). Used by `handleCallback` to determine the current menu depth.

**`handleCallback(req, res)`**
The main USSD handler. Reads `sessionId`, `phoneNumber`, and `text` from the POST body. Guards against malformed requests (missing `sessionId` or `phoneNumber`) with an `END` response. Delegates to the appropriate menu branch based on `steps[0]` and `steps[1]`.

On a confirmed callback request (`text = "1*1"`), creates a `UssdCallbackRequest` row with:
- `callbackRequestId` — UUID
- `requesterPhoneNumber` — the caller's phone number from AT
- `callbackFulfillmentStatus` — `'PENDING'`

If the database write fails, responds with an `END` message directing the user to call the hotline directly rather than silently failing.

### NGO Admin endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ussd/callback-requests` | Returns all callback requests, newest first. NGO_ADMIN only. |
| `PATCH` | `/api/ussd/callback-requests/:requestId` | Updates fulfillment status to `COMPLETED` or `CANCELLED`. NGO_ADMIN only. Only `PENDING` records can be updated. |

These are authenticated via `authMiddleware` and restricted to the `NGO_ADMIN` role. They power the USSD callback queue in the NGO admin dashboard.

---

## Local Development Setup

To test USSD locally, Africa's Talking's sandbox simulator needs to reach your machine over the internet. Since the backend runs on `localhost:5000`, you need ngrok to create a public tunnel.

### Prerequisites

- Backend server running (`npm run dev` in `backend/`)
- ngrok installed (already present at `~/.nvm/versions/node/v20.19.5/bin/ngrok`)
- An Africa's Talking account with sandbox access

### Step 1 — Authenticate ngrok

Get your authtoken from **dashboard.ngrok.com** → Your Authtoken, then run:

```bash
ngrok config add-authtoken YOUR_TOKEN_HERE
```

This only needs to be done once.

### Step 2 — Start the backend

```bash
cd backend && npm run dev
```

Confirm it's running:

```bash
curl http://localhost:5000/api/health
# → {"status":"ok"}
```

### Step 3 — Start ngrok

In a separate terminal:

```bash
ngrok http 5000
```

ngrok prints a public URL:

```
Forwarding    https://abc123.ngrok-free.app -> http://localhost:5000
```

Your callback URL is:

```
https://abc123.ngrok-free.app/api/ussd/callback
```

Verify the tunnel is working:

```bash
curl https://abc123.ngrok-free.app/api/health
# → {"status":"ok"}
```

### Step 4 — Configure the AT sandbox

1. Log into **sandbox.africastalking.com**
2. Go to **USSD** in the left sidebar
3. Create or edit a USSD channel
4. Set **Callback URL** to your ngrok URL + `/api/ussd/callback`
5. Save — AT assigns you a shortcode (e.g. `*384*183523#`)

### Step 5 — Test with the simulator

1. In the AT sandbox dashboard, go to **Simulator**
2. Enter any phone number
3. Dial your shortcode
4. Navigate the menu — each selection POSTs to your local server via ngrok

You can watch requests hit your server in the ngrok terminal, and also open the ngrok web inspector at `http://localhost:4040` to see the full request/response for every AT POST.

### Important ngrok limitations

- **Free tier URLs are temporary.** Every time you restart ngrok you get a new URL, and you must update the callback URL in the AT dashboard.
- **No session time limit.** The tunnel stays alive indefinitely as long as the `ngrok http 5000` process keeps running — it does not expire after a fixed time.
- **Sessions drop if the process dies.** If the terminal is closed or ngrok crashes, AT will show the default fallback message ("You have reached Africa's Talking USSD Services...") instead of your menu. Restart ngrok and update the AT callback URL when this happens.
- **One tunnel at a time** on the free plan.

---

## Troubleshooting

### Simulator shows "You have reached Africa's Talking USSD Services..."

This is AT's default fallback — your callback URL is not being reached. Check:

1. ngrok is still running (`curl https://your-url.ngrok-free.app/api/health` should return `{"status":"ok"}`)
2. The callback URL in the AT USSD channel settings includes `/api/ussd/callback` — not just the base ngrok URL
3. The backend server is running

### Simulator shows nothing / hangs

The server returned a response AT couldn't parse. Check that the response starts with exactly `CON ` or `END ` (note the trailing space) and is `Content-Type: text/plain`.

### Callback request not appearing in NGO dashboard

Check the server logs for `[USSD] Failed to save callback request` — this indicates a database error. Confirm the `UssdCallbackRequest` table exists and the database is running.

---

## Session Timeout and Retry Behaviour

Africa's Talking enforces a **30-second response timeout** per menu step. If the backend does not return a `CON` or `END` response within 30 seconds, AT terminates the session and shows the user a network error message. Causes:
- Database write taking too long (check MySQL connection pool size and `UssdCallbackRequest` table locks)
- Server cold-start or high load

There is no automatic retry mechanism at the USSD layer. If a session ends due to timeout, the user must dial again. Keeping the `handleCallback` controller response path fast (target < 2 seconds) is important.

**Error recovery in the menu**: unrecognised inputs respond with `END` ("Invalid selection. Please dial again.") rather than looping. This is a deliberate design decision — re-prompting with `CON` risks confusing users on metered connections where each request incurs a charge. The user dials again from the top.

**Database write failure**: if saving the `UssdCallbackRequest` fails (e.g. MySQL is unreachable), the controller responds with `END "Unable to process your request. Please call our hotline directly."` along with the emergency number. The user is never left with a silent failure.

---

## Sandbox-to-Live Migration

To switch from the Africa's Talking sandbox to a live production account:

1. **Create a live Africa's Talking account** at [africastalking.com](https://africastalking.com) and complete business verification.
2. **Register a USSD shortcode** — either a dedicated shortcode (e.g. `*344*1#`) or a shared shortcode with a unique service code suffix. AT assigns the shortcode after review.
3. **Register a callback URL** on the live account dashboard pointing to `https://your-production-domain.com/api/ussd/callback`.
4. **Update environment variables**:
   ```
   AFRICASTALKING_USERNAME=your_live_account_username   # NOT "sandbox"
   AFRICASTALKING_API_KEY=your_live_api_key
   ```
5. **IP allowlist**: restrict `POST /api/ussd/callback` at the Nginx or firewall level to [Africa's Talking's published IP ranges](https://developers.africastalking.com/docs/ussd/before_you_start). The endpoint has no token authentication by design.
6. **Test with a real device** using the live shortcode before announcing it publicly.

The `validateEnv()` boot guard enforces `AFRICASTALKING_USERNAME !== "sandbox"` when `NODE_ENV=production`, preventing accidental production deploys with sandbox credentials.

---

## Auto-Assignment of Callbacks

When a USSD callback request is saved, `pickLeastLoadedCounsellor` automatically assigns it to the counsellor with the lowest `currentWorkloadScore` whose `UserAccount.accountStatus` is `ACTIVE`. The NGO Admin queue shows the "Assigned To" column populated immediately — no manual triage step is needed, though the admin can reassign via the PATCH endpoint.

---

## Production Considerations

- Replace the ngrok tunnel with a stable public URL (your deployed server).
- Restrict `POST /api/ussd/callback` to Africa's Talking's IP ranges at the reverse-proxy or firewall level — the endpoint has no auth by design.
- Update `AFRICASTALKING_USERNAME` from `sandbox` to your live AT account username.
- The shortcode will change from the sandbox shortcode to a production shortcode assigned by AT.
- See [docs/deployment.md](deployment.md) for the full production environment checklist.
