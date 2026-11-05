# Self-hosted signaling relay

WebRTC signaling relay for the simulator's room-code mode. It replaces the
public PeerJS broker (`wss://0.peerjs.com`) when the site is built with
`NEXT_PUBLIC_SIGNAL_URL`. It does **not** replace STUN/TURN, media, or the
leaderboard Worker: after signaling, the two browsers still connect
peer-to-peer with the existing STUN list.

## How it works

- `GET /signal/<6-char room code>?role=host|guest` (WebSocket upgrade).
  One Durable Object instance per room code, at most one host and one guest.
- Message shape is the same as the existing PeerJS path, so the client
  reuses its `OFFER` / `ANSWER` / `CANDIDATE` handling: the relay rewrites
  `src` to the sender's role (`host` / `guest`) and forwards to the other
  role. On connect it sends `{ type: 'OPEN' }`, which is what the client's
  host/guest handlers already wait for.
- A message for a not-yet-connected peer is buffered (in memory, capped at
  50) and flushed in order when that peer connects.
- When a socket closes, its role slot frees up. When both slots are empty,
  or a room is idle for 30 minutes, an alarm clears the room state.
- No login, no TURN credentials, no secrets in code. Security is the same
  as the PeerJS room-code model: anyone who knows a code can join that
  room as host or guest.

## TURN credentials (optional, multi-provider fallback)

`GET /turn` mints short-lived Cloudflare TURN credentials (turns:443
only) for the game client. The client also accepts static TURN servers
from the build (`NEXT_PUBLIC_TURN_URLS` for one provider, or
`NEXT_PUBLIC_TURN_SERVERS` as a JSON array for several providers with
different credentials) and a player-entered TURN server, and tries every
configured TURN in parallel — a blocked provider does not stop the
others. The runtime list is cached in memory only, never in
localStorage, and a slow or missing `/turn` never delays a room join
(the fetch is capped at 2.5 s and falls back silently).

Set the secrets only with `wrangler secret put` (never in code or in
this file):

```sh
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_API_TOKEN   # dedicated Dashboard token, Calls permission
```

While either secret is unset, `/turn` returns 503
`turn_not_configured` and the game uses only its static TURN servers.
`/turn` accepts only the two game origins (pages.dev and wysaiche),
never `"*"`.

## Deploy (parent agent does this; this Worker is not deployed by default)

```sh
cd scripts/signal-worker
npx -y wrangler@4 deploy
```

That creates the Worker and the `SignalRoom` Durable Object binding. No KV
namespace is needed, and no `wrangler.toml` value has to be edited for a
first deploy (there is no placeholder id, unlike the leaderboard Worker).

## Connect the simulator

Rebuild the site with the relay origin (no trailing slash, no `/signal`
suffix — the client appends `/signal/<code>?role=...` itself):

```sh
NEXT_PUBLIC_LEADERBOARD_URL=https://saichepaiming.2221314.xyz \
NEXT_PUBLIC_SIGNAL_URL=https://<signal-domain> \
npm run build
```

Without `NEXT_PUBLIC_SIGNAL_URL` the site keeps the existing
`0.peerjs.com` behaviour unchanged, as a fallback.

## Custom domain — read this before relying on the workers.dev address

Binding a custom domain to a Worker through the Cloudflare API has
previously returned 405 with this account's API token, so the custom-domain
step may need to be done manually in the Dashboard (Workers & Pages →
the Worker → Settings → Domains → Add a custom domain). Whether the
relay also needs a custom domain to be usable from mainland China without
a VPN is **not proven**: the leaderboard Worker on `workers.dev` has
previously returned 1101 in some checks while its custom domain returned
200, and the same workers.dev question may apply here. Do not claim the
relay is reachable from China until it is tested from there on the domain
actually deployed. The health endpoint `GET /` (or `/health`) returns
`{"ok":true,"service":"librecorsa-signal"}` for a quick check.

## Known limits (honest, not yet verified on two real devices)

- Buffered messages live in memory: if the Durable Object hibernates
  before the second peer connects, buffered messages are lost and the
  joining peer must retry (the panel's join button retries; the 30 s
  join timeout still applies).
- If a peer's socket closes mid-signaling, the other side learns about it
  only through the existing client timeouts, not through a dedicated
  "peer left" signal (the current client ignores unknown message types).
- A duplicate role gets `{ type: 'ERROR', error: 'room_full' }` and a
  close; the client reports that as a signaling error.
- This relay fixes signaling delivery only. If signaling succeeds but
  ICE still cannot find a path (strict NAT / mobile data), the existing
  20 s ICE timeout and TURN guidance still apply.
