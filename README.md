# WatchTogether

A private watch-party app: sign up, upload a movie you own (or paste a
direct video URL), create a room, and watch in sync with friends — with
live chat and reactions. Built to deploy cleanly on **Vercel**.

## Stack

- **Next.js 14** (App Router), plain serverless — no custom server
- **Postgres** for data (any provider — Vercel Postgres, Neon, Supabase...)
- **Vercel Blob** for uploaded video files
- **Pusher Channels** (free tier) for real-time sync, chat, and presence
  (who's in the room) — this replaces a traditional WebSocket server, since
  serverless functions can't hold a persistent connection open themselves
- **JWT in an httpOnly cookie** for auth (bcrypt-hashed passwords)

## Why this specific stack

Vercel deploys Next.js as serverless functions: no long-lived process, and
no writable local disk between requests. That rules out a local SQLite
file, local file uploads, and a custom Socket.io server — all three are
swapped here for hosted equivalents that work within that model.

## 1. Set up the three services (all have free tiers)

**Database — Postgres**
- Easiest: in your Vercel project dashboard, go to **Storage → Create
  Database → Postgres** (powered by Neon). It sets `DATABASE_URL`
  automatically once connected to the project.
- Or use any Postgres you already have (Neon, Supabase, Railway...) and set
  `DATABASE_URL` yourself.

**File uploads — Vercel Blob**
- In your Vercel project: **Storage → Create Database → Blob**. It sets
  `BLOB_READ_WRITE_TOKEN` automatically once connected.
- Uploads work without this being set up too — you'll just get an error
  message if someone tries to upload a file. Pasting a video URL still
  works fine either way.

**Real-time — Pusher Channels**
- Create a free account/app at https://dashboard.pusher.com → **Channels →
  Create app**.
- Under **App Keys**, copy: `app_id`, `key`, `secret`, `cluster`.
- Set these in Vercel (Project → Settings → Environment Variables):
  - `PUSHER_APP_ID`
  - `PUSHER_KEY`
  - `PUSHER_SECRET`
  - `PUSHER_CLUSTER`
  - `NEXT_PUBLIC_PUSHER_KEY` — same value as `PUSHER_KEY`
  - `NEXT_PUBLIC_PUSHER_CLUSTER` — same value as `PUSHER_CLUSTER`

  (The `NEXT_PUBLIC_` versions are what the browser uses to connect; the
  plain ones are used server-side to send events.)

Also set `JWT_SECRET` to any long random string.

After setting env vars in Vercel, **redeploy** — env var changes don't
apply to already-built deployments.

## 2. Local development

```bash
npm install
cp .env.example .env   # fill in the values from step 1
npm run dev
```

Open http://localhost:3000.

## How sync works

1. Whoever plays, pauses, or seeks calls the app's `/api/rooms/[code]/broadcast`
   route, which relays the event to everyone else in the room over Pusher.
2. Every few seconds, the controller also sends a heartbeat with their
   current time, so someone who drifts catches up automatically.
3. If a client's local time is more than ~1.2s off from what it receives,
   it snaps to the correct time instead of just letting playback continue —
   but only if it isn't *already* mid-seek/buffering from the last
   correction. Piling a new seek on top of one still resolving is what
   caused the play/pause thrashing right after someone joined; this guard
   fixes that.
4. On joining, a new viewer immediately asks whoever's in control for a
   snapshot (`player:request-sync`) instead of waiting up to 4s for the next
   scheduled heartbeat — this shortens how long they sit at a stale/zero
   position before the first correction.

This is a "best effort" sync model, not frame-accurate broadcast-grade sync
— good enough for a shared movie night.

## Multi-video rooms (queue)

A room's original video (set at creation) is permanent — it's the room's
identity, and what shows on the invite page. What's actually playing is
tracked separately (`current_video_*` in the `rooms` table) and can move
through a **queue**:

- Anyone in the room can paste a YouTube link in chat; a
  "➕ Add to queue" button appears under that message and adds it to
  `room_queue` (visible to everyone, live).
- Only the host can advance to the next queued video ("▶️ Play next" in the
  queue panel under the player), which updates `current_video_*` and
  broadcasts `room:video-changed` to everyone.
- The original `video_url`/`video_title` are never touched by any of this.

## Production checklist

- Use a strong random `JWT_SECRET`
- Consider rate limiting `/api/auth/*` and `/api/upload`
- Only allow uploading/sharing video content you own or have rights to
- Vercel Blob's free tier and Pusher's free tier both have usage caps —
  check current limits if you expect real traffic

## Room capacity enforcement

There are two layers:
1. The Pusher presence-channel auth route (`/api/pusher/auth`) rejects a
   join once the room's member count reaches its cap.
2. The room page itself calls `/api/rooms/[code]/can-join` **before**
   rendering the video or chat at all. This closes a gap where a full room
   would still play the video (since fetching room info doesn't check
   capacity) even though live chat/sync silently failed — which looked
   like the cap wasn't enforced.

The cap can be changed any time from inside the room (host-only, with
+/− buttons and quick presets), and updates live for everyone via
`room:capacity-changed`. There's no "unlimited" option — every room has a
real numeric cap (1–500).

Note: capacity enforcement checks Pusher's REST API for the current member
count at join time, which is not perfectly atomic — two people joining in
the same instant could both slip in when there's exactly one slot left.
For a small watch-party app this edge case is rare enough to accept rather
than adding a distributed-locking layer.

## Host controls

The room creator is the host (shown with a "Host" badge). By default, only
the host can play/pause/seek. The host can open the participant list in
the chat panel and make (or remove) specific viewers as **co-hosts**,
letting them also control playback. This permission is **ephemeral** — it
resets if the page reloads, since it isn't persisted to the database, only
broadcast live to whoever's currently in the room.

Playback controls (including fullscreen) stay visible and clickable for
everyone — there's no browser-native or YouTube-API way to show only the
fullscreen button while hiding play/pause. Instead, a non-controller's
play/pause/seek simply isn't broadcast to the room, so it only affects
their own view; the host's next heartbeat (every ~4s) pulls them back into
sync automatically.

## Changing the room after it's created

- **Room size**: the host can edit the participant cap any time from the
  room page itself (not just at creation) — this updates live for everyone
  currently in the room.
- **Deleting a room**: from the Watch Rooms list, the host can delete any
  room they created.
- **Switching the video**: superseded by the queue system — see
  "Multi-video rooms (queue)" above.

## Uploads

Uploads go **directly from the browser to Vercel Blob** (not through a
serverless function) using `@vercel/blob/client`'s token-based upload flow.
This matters because Vercel serverless functions cap request bodies at a
few MB — routing a whole video file through one fails with a body-size
error. The `/api/upload` route only issues a short-lived signed token; the
actual file bytes never pass through it.

The upload form shows live progress as **MB uploaded / total MB** (not just
a percentage), and warns if progress hasn't moved in 15+ seconds so a slow
or stalled upload doesn't look identical to a working one.

**Important bug fix**: the upload route used to check for a login cookie
on every request to it — but Vercel Blob calls that same route a *second*
time, server-to-server, once each upload finishes, with no browser cookie
attached. That callback kept getting rejected, which was the root cause of
uploads that looped/never completed. The auth check now only applies to
the initial "give me a token" request from the browser.

## Joining a room

Joining requires an account — there's no anonymous/guest access. Sharing
a room sends people to `/invite/[code]`, a preview page (title, viewer
count, live/waiting status) with a **Sign in to join** / **Create an
account** prompt if they aren't signed in yet; after signing in they're
sent straight back to the room. This is enforced both in the UI and
server-side (the Pusher presence-channel auth route rejects unauthenticated
requests), so a bookmarked room link can't be used to skip sign-in.

## Room size limits

Every room has a required numeric cap (1–500) — picked at creation (quick
presets 1/2/3/5/10, or type any number), and editable any time afterward
from inside the room. See "Room capacity enforcement" above for how it's
enforced. The host is always exempt from their own cap.

## Host controls

The room creator is the host (shown with a "Host" badge). By default, only
the host can play/pause/seek — everyone else sees a locked player with a
"Host controls playback" badge. The host can open the participant list in
the chat panel and grant (or revoke) control to specific viewers, letting
them co-drive playback. This permission is **ephemeral** — it resets if
the page reloads, since it isn't persisted to the database, only broadcast
live to whoever's currently in the room.

## Project structure

```
lib/
  db.js                 # Postgres schema + queries (users, movies, rooms)
  auth.js                # password hashing, JWT, cookies
  pusher.js               # server-side Pusher client
  pusher-client.js         # browser-side Pusher client
  use-current-user.js       # client hook: fetch /api/auth/me, redirect if signed out
  youtube.js                 # YouTube URL -> video ID parsing
app/
  page.js                # landing page
  login/, signup/         # auth pages (support ?redirect=/room/CODE)
  dashboard/              # home: welcome + stats + quick actions
  library/                 # movie library: upload + list + delete
  rooms/                    # active rooms + join by code
  rooms/create/              # create a room: library movie, YouTube, or URL; room size
  room/[code]/                # the live watch room (video + chat), auth-gated
  invite/[code]/               # public preview/gate page for shared invite links
  api/
    auth/{signup,login,logout,me}/
    movies/  movies/[id]/
    rooms/  rooms/[code]/  rooms/[code]/broadcast/  rooms/[code]/presence/
    upload/                      # issues Vercel Blob client-upload tokens
    pusher/auth/                  # presence-channel auth + room-size enforcement
components/
  Nav.js                  # shared top nav for signed-in pages
  VideoPlayer.js            # synced <video> element, host-gated controls
  YouTubePlayer.js            # synced YouTube IFrame player, host-gated controls
  Chat.js                       # live chat (deduped/optimistic) + reactions + participant list
```

## How the movie library works

Uploading is a separate step from creating a room, matching the reference
flow: upload once to your library (stored via Vercel Blob + a `movies` row),
then create as many rooms from that movie as you like. Rooms can also be
created from a YouTube link or a direct video URL instead.

## YouTube support

YouTube rooms use the YouTube IFrame Player API (not a plain `<video>`
element, since YouTube videos can't be played that way). Sync works the
same as direct video: whoever plays/pauses/seeks broadcasts it, and a
heartbeat every few seconds keeps everyone within ~1.5s of each other
(a bit looser than direct video's ~0.75s, since YouTube's reported playback
time is less precise). Supported link formats: `youtube.com/watch?v=...`,
`youtu.be/...`, `youtube.com/shorts/...`, `youtube.com/embed/...`.

## If chat or the viewer count still isn't working

The presence/chat system depends entirely on Pusher being configured
correctly. Open the browser console in the room — the app now logs Pusher
connection and subscription errors there. Things to double check:
- `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` were set **before**
  the last deploy that's currently live (Next.js bakes `NEXT_PUBLIC_*` vars
  into the browser bundle at build time — adding them after a build doesn't
  retroactively apply, you need a fresh deploy)
- The plain `PUSHER_KEY`/`PUSHER_CLUSTER` match the `NEXT_PUBLIC_` versions
  exactly (same Pusher app)
- The Pusher app's cluster (e.g. `ap2`, `us2`) is correct — this is easy to
  copy wrong

