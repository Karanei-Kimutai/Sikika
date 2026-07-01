# Troubleshooting Runbook

This runbook is organised by symptom. Each section describes the most likely causes and steps to diagnose and resolve the issue.

---

## Authentication Failures

### OTP never arrives on the user's phone

**Check in order:**

1. **`SKIP_SMS_IN_DEV`** — if this is `true`, the OTP is returned in the response body as `developmentOtp` and is **not** sent via SMS. Check `backend/.env`; set to `false` in production.
2. **Sandbox vs. live credentials** — `AFRICASTALKING_USERNAME=sandbox` prevents real SMS delivery. Verify that `AFRICASTALKING_API_KEY` and `AFRICASTALKING_USERNAME` are live values in production.
3. **Africa's Talking account balance** — log in to the Africa's Talking dashboard and check SMS credits. Delivery silently fails when credits are exhausted.
4. **OTP rate-limit lockout** — `UserAccount.otpAttemptCount` increments on each failed OTP verification. If it reaches the threshold, OTP requests from the same account return an error. Check the `UserAccount` row for the phone number and reset `otpAttemptCount=0` if necessary.
5. **Recipient phone format** — Africa's Talking requires E.164 format (e.g. `+254711000001`). The backend normalises the input, but confirm the phone number was entered with country code.
6. **Check Africa's Talking delivery reports** — the dashboard shows whether the SMS was accepted, delivered, or failed with an error code.

---

### Account is locked; user cannot sign in

The backend uses two separate lockout counters:

- **Password lockout** — `UserAccount.authFailedAttempts` increments on wrong password. `UserAccount.authLockUntil` is set to a future timestamp after too many failures. `login-password` returns an error while the lock is active.
- **OTP lockout** — `UserAccount.otpAttemptCount` increments on wrong OTP.

**To unlock manually:**

```sql
UPDATE UserAccount
SET authFailedAttempts = 0,
    authLockUntil = NULL,
    otpAttemptCount = 0
WHERE phoneNumber = '+254711XXXXXX';
```

For banned accounts, use the NGO Admin dashboard → Moderation Desk → Banned Users → Lift Ban.

---

### JWT expired mid-session (user sees sudden sign-out)

JWT expiry causes:
- Active REST requests return HTTP 401.
- Socket connections drop (the server verifies the JWT on every socket connect and per-message send).
- The frontend's auth check (`getToken()` is present but all requests 401) causes the app to redirect to `/join`.

This is expected behaviour. The user must sign in again. If expiry is too frequent, increase `JWT_EXPIRES_IN` in `backend/.env` (not set by default — check the `jsonwebtoken` `sign` call in `authController.js`).

---

### Signup ticket expired

The signup ticket issued in step 2 of the 3-step signup flow has a short TTL (it is stored as a bcrypt hash in `otpHash` alongside an expiry). If the user takes too long between OTP verification and completing their profile details, `complete-signup` returns an error.

**Resolution:** The user must restart the signup flow from step 1 (phone → OTP → details). There is no way to extend a ticket server-side.

---

### Staff first-login forced reset not completing

The `set-password` endpoint requires the temporary JWT issued by `login-password` (`authStage=PASSWORD_RESET_REQUIRED`). If the user refreshes the page during the first-login reset flow, `firstLoginAuthToken` in `SignInFlow` state is cleared.

**Resolution:** The user must sign in again with the temporary password to get a new temporary JWT, then complete the reset.

---

## E2EE Chat Issues

### Messages are not sending; composer shows "Awaiting counterpart key"

The counterpart user has not yet logged in and registered their ECDH public key. Messages are held in `localStorage` under `pendingMessages:<chatId>`.

**How it resolves automatically:**
- When the counterpart logs in, `App.jsx` registers their public key via `PUT /api/chat/public-key`.
- `chatController.js` `setPublicKey` fans a `chatKey:available` Socket.io event to all channel counterparts.
- `DirectChatPage.jsx` receives the event and drains the pending queue.
- A 30-second poll fallback also checks for the counterpart key periodically.

**Manual diagnosis:**
```sql
-- Check if counterpart has a registered key
SELECT ecdhPublicKey FROM UserAccount WHERE userId = '<counterpart-uuid>';
```
A NULL result means they haven't logged in yet. An empty string means registration failed.

---

### Pending messages are stuck and not sending

1. Open browser DevTools → Application → Local Storage.
2. Find keys matching `pendingMessages:<chatId>`.
3. Verify the messages are present (they should be an array of `{ payload, iv, timestamp }` objects).
4. Check whether the `chatKey:available` socket event is being emitted by the backend. Look in backend logs for `chatKey:available` after the counterpart logs in.
5. If the counterpart has a public key registered but messages are still stuck, check that the ECDH key derivation is succeeding: open the browser console on `DirectChatPage` and look for errors in `deriveSharedKey`.

---

### Messages show no delivered or seen tick

- **No delivered tick** — the recipient is offline. `deliveredAt` is set on `DirectChatMessage` when the recipient's socket receives the message (online delivery) or when they reconnect (delivery catch-up bulk-set). Check `presenceRegistry` state via backend logs.
- **No seen tick** — the recipient has not called `markChannelRead`. This happens when they have not opened the specific chat channel. `seenAt` is set and `message:seen` is emitted by `chatSocket.js` when `markChannelRead` is received.

---

### Private key lost; old messages undecryptable

If the user clears IndexedDB (browser data wipe, new browser profile, new device), the non-extractable private key is gone. There is no server-side key backup by design.

**Consequence:** Old messages encrypted with the previous shared key are permanently undecryptable. New messages after re-login will use a new keypair.

**Resolution:** The user re-logs in. `App.jsx` runs `getOrCreateKeyPair`, which generates a new ECDH keypair and registers the new public key. The counterpart must also be online (or next-log-in) for the new shared key to be derived.

This is a known limitation documented in `docs/e2ee.md`.

---

## Socket Connection Issues

### User is banned mid-session; socket keeps reconnecting

When a user is banned, `disconnectSockets(true)` is called immediately, closing all socket connections for that `userId` from the server side. Socket.io client auto-reconnects by default. Each reconnect attempt hits the server's `connection` handler, which checks `UserAccount.accountStatus` and rejects the socket if it is `BANNED`. The reconnect backoff should eventually stop, but the client may cycle through a few retries before settling.

**For the banned user:** Signing out clears `authToken` from sessionStorage, so after the tab is refreshed or next opened, there is no token to present and sockets do not connect.

---

### Socket connects but events are not received

1. **JWT validity** — the socket handshake sends the JWT as `auth.token`. If the JWT is expired, the server rejects the connection at the authentication middleware level. Check for `401` in socket error events on the client.
2. **Room membership** — community chat events are scoped to room-specific Socket.io rooms. A user must have called `POST /api/community/rooms/:roomId/join` (REST) before the socket `joinRoom` event is processed. Without prior REST join, the socket join is rejected.
3. **Silently dropped messages** — some socket events are silently dropped if preconditions are not met (e.g. sending a message to a channel you are not a participant of). Check backend logs for `"Silently dropped"` prefixed log lines in `chatSocket.js`.
4. **Namespace mismatch** — all socket events use the default `"/"` namespace. Third-party tools connecting to a named namespace will not receive events.

---

## Schema / Boot Failures

### `SequelizeDatabaseError: Data truncated for column` at boot

A ENUM column was altered to remove an existing member that existing rows still use. `ensureSchemaCompatibility` runs a data-backfill `UPDATE` first to migrate existing values, then runs `MODIFY COLUMN` to extend the ENUM. If you bypassed `schemaCompatibility.js` and ran a manual `ALTER TABLE` that removed an ENUM member, this error occurs.

**Resolution:**
1. Identify which ENUM column and value is causing truncation from the error message.
2. Add a reconciliation step to `backend/src/utils/schemaCompatibility.js` that backfills the obsolete value to a valid one before the `MODIFY COLUMN` runs.
3. Set `ENABLE_SCHEMA_COMPAT=true` and restart.

---

### Boot-time `ensureSchemaCompatibility` log says "error"

Check the structured log emitted on boot:

```
[schemaCompat] { checked: [...], applied: [...], skipped: [...], errors: [...] }
```

- `checked` — reconciliation steps that verified existing state, no DDL needed.
- `applied` — DDL steps that ran successfully.
- `skipped` — steps skipped because `ENABLE_SCHEMA_COMPAT=false`.
- `errors` — steps that failed.

For each error, inspect the error object and the specific DDL statement that failed. Common causes: MySQL user lacks `ALTER TABLE` privilege, or the column doesn't exist yet (because the table was never created — run the full sync first).

---

### `DB_SYNC_ALTER=true` in production caused data loss

Sequelize in `alter: true` mode compares the current model definition to the database schema and runs `ALTER TABLE` statements to make the DB match the model. This can **drop columns** that exist in the DB but not in the model (e.g. columns added by a previous developer's migration that haven't been ported to a model yet).

`DB_SYNC_ALTER=false` is the safe default. If you accidentally ran with `alter: true`, restore from your last backup and audit what changed.

---

## Cloudinary Issues

### Upload endpoints return HTTP 503

The backend checks for Cloudinary credentials at startup and on the first upload call. If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, or `CLOUDINARY_API_SECRET` are missing or blank, the upload middleware returns 503 with the message "File storage is not configured."

**Resolution:** Set all three variables in `backend/.env` and restart the server.

The Library resource list still works without Cloudinary (it falls back to `fallbackResources.js`), so 503 on uploads does not break the read-only public library.

---

### Evidence or resource file streaming returns 404 or 403

The streaming proxy (`GET /api/resources/:resourceId/file`, `GET /api/reports/:reportId/evidence/:evidenceId/file`, `GET /api/legal-cases/:legalCaseId/document`) uses `fetchPrivateAssetStream` which:
1. Generates a `private_download_url` from Cloudinary for the stored `publicId`.
2. Fetches that URL and pipes the response to the client.

Possible causes:
- **Wrong `publicId`** — the `publicId` stored on the DB record does not match an actual Cloudinary asset. This can happen if an upload succeeded partially (file written to Cloudinary but DB transaction rolled back). Check the stored `cloudinaryPublicId` field against the Cloudinary dashboard.
- **Wrong resource type** — `fetchPrivateAssetStream` must be called with `resourceType: "raw"` for PDFs and `resourceType: "image"` for images. A mismatch causes a Cloudinary 404 on the signed URL.
- **Expired signed URL** — the private download URL has a short TTL (set by Cloudinary). The backend fetches and streams in a single request, so this should not be an issue unless there is extreme latency between the URL generation and the fetch.

---

## USSD Issues

### Callback requests not appearing in the admin queue (local development)

Africa's Talking sends USSD events to the registered callback URL via public internet. In local development, your backend is on `localhost`, which is not reachable from Africa's Talking.

**Resolution:** Use [ngrok](https://ngrok.com/) to expose your local server:

```bash
ngrok http 5000
```

Copy the generated public URL (e.g. `https://abc123.ngrok.io`) and set it as the USSD callback URL in the Africa's Talking sandbox dashboard. Restart after each ngrok session since the URL changes.

---

### USSD session times out mid-flow

Africa's Talking enforces a **60-second timeout** on USSD sessions. If the backend takes more than 60 seconds to respond, the session is dropped from the user's handset.

**Resolution:**
- Ensure all DB queries in `ussdController.js` are indexed and fast.
- Avoid synchronous/blocking operations in the USSD callback handler.
- Keep the USSD menu flow shallow (fewer round-trips).

---

### USSD short message too long

Africa's Talking truncates USSD messages at 182 characters (standard) or 160 characters on some networks. If a menu option list is too long, the user sees a truncated screen.

**Resolution:** Shorten menu text in `ussdController.js`. Use abbreviations or split into sub-menus.

---

## Notification Delivery Failures

### Notification not received in real-time

The notification system uses two delivery paths:
1. **Socket.io push** — `notificationService.createNotification` emits `notification:new` to the user's `user:<userId>` room immediately.
2. **30-second poll fallback** — `NotificationBell` polls `GET /api/notifications?unread=true` every 30 seconds.

If real-time delivery fails but the poll fallback works, the socket connection is the problem. Check:
- Is the user's socket connected to the `user:<userId>` room? The socket joins this room automatically on `connection` in `chatSocket.js`.
- Did the event that should trigger a notification actually call `notificationService.createNotification`? Check `reportController.js`, `chatSocket.js`, and `communityController.js` for the relevant trigger paths.
- Is the user's JWT still valid? Socket connections are dropped on JWT expiry.

---

### Notification badge count not updating

The badge count in `NotificationBell` is driven by `GET /api/notifications?unread=true`. The count won't update if:

- **`notificationDismissedStatus=true`** is set incorrectly on records that are still unread. `notificationDismissedStatus` is set independently of `notificationReadStatus` — check that the dismiss endpoint is not being called accidentally.
- **Polling interval delayed** — the 30-second poll uses `setInterval`. If the component unmounts and remounts (e.g. the user navigates away and back), a new interval is set. Multiple intervals racing is unlikely but check for it with browser DevTools.
- **Auth header missing** — `getUnreadCount` includes `Authorization: Bearer <token>`. If `getToken()` returns null, the request returns 401 and the count silently stays at 0.

---

## General Debugging Tips

### Check backend logs

PM2 captures stdout/stderr. Use:

```bash
pm2 logs sikika-backend --lines 100
```

In development, `npm run dev` (nodemon) prints logs to the terminal. Backend log lines are prefixed with `[schemaCompat]`, `[chatSocket]`, `[presenceRegistry]`, etc. for easier filtering.

### Inspect the JWT payload

The JWT payload contains `id`, `userId`, `role`, and `iat`/`exp`. Decode it without verification:

```bash
echo "<token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Check that `exp` is in the future and `role` matches what the frontend decoded.

### Force-reset a stuck maintenance mode

If the application is in maintenance mode and the NGO Admin cannot authenticate:

```sql
UPDATE SystemSetting
SET settingValue = '{"enabled":false,"updatedAt":null,"reason":null,"expectedUntil":null}'
WHERE settingKey = 'maintenance';
```

Then restart the backend process to reload `_maintenanceCache` from the DB.

### Reset a survivor's assigned staff

If auto-assignment failed during signup and a survivor has null counsellor/legal counsel assignments:

```sql
UPDATE SurvivorProfile
SET assignedCounsellor = '<counsellor-uuid>',
    assignedLegalCounsel = '<legal-counsel-uuid>'
WHERE userAccountId = '<survivor-uuid>';
```

Then call `ensureAutoChannelsForSurvivor` for that survivor — or trigger it naturally by having the survivor visit the Direct Chat page, which calls `GET /api/chat/channels` which calls `ensureAutoChannelsForSurvivor` as a side effect.
