# TShockWebUI

> English | [中文](README.md)

A companion for **TShock** — for server owners and players alike!

It is built around running commands in the browser through the TShock REST API. Accounts and permissions follow TShock's own model.

Highlights:

- **Home**: preset command cards wrap common information queries and run automatically every two minutes, so you can see what is happening on the server at a glance.
- **Command cards**: render the results of most commands, including item icons (`[i:29]`) with item tooltips on hover. Card width and auto-execution are configurable.
- **Item lookup**: item IDs, recipes, shimmer decrafting/transmutation. Includes the game's 11 creative-menu groups plus personal item-ID collections, and can simulate prefix effects for weapons and accessories.
- **Data lookup**: multiple data ID types, including items, NPCs, buffs, tiles and walls.
- **Command cheat sheet**: command usage and detailed descriptions, with quick execution (still a bit rough; being improved).
- **Save files**: view `.plr` player saves and `.wld` world saves. Some fields can be edited; write-back has been validated against the 1.4.5.8 save formats, but due to limited ability, edited saves are not guaranteed to work perfectly in game.

- **Messenger plugin**: together with this project's messenger plugin, chat with players in game. Players who need building materials can submit material requests from the web.

- **FishShop plugin integration**: buy FishShop goods in the browser. Nobody knows the FishShop better than the 🐟 FishShop Spider 🕷, so we might as well do it ourselves.

- **PlayerManager (`pm`) plugin integration**: aimed at server owners — view inventories for all players, including offline players. Player saves can also be exported from the web.
- **WorldModify (`wm`) plugin integration**: comes with lots of commands, mainly for server owners — plus player-facing ones such as world info, boss progress, respawning NPCs and cleaning tombstones. TShock decides permissions based on the player's identity.

- **Multi-server support**: add multiple TShock servers and switch between them (requires `TSHOCK_ALLOW_CUSTOM_TARGETS`, off by default).

## Quick start

**TShock side**
Edit `config.json` to enable the TShock REST API:

```json
"RestApiEnabled": true,
"RestApiPort": 7878,
"LogRest": true,
"RESTMaximumRequestsPerInterval": 50,
"RESTRequestBucketDecreaseIntervalMinutes": 10,
```

Allow regular players to use the REST API and execute commands through it (replace `default` with the player's group):

```bash
/group addperm default tshock.rest.useapi
/group addperm default tshock.rest.command
```

- `tshock.rest.useapi`: allows creating a token (logging in)
- `tshock.rest.command`: allows executing commands

Install the messenger plugin: [WebUI-0.1.0-rc.9.dll](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.9/WebUI-0.1.0-rc.9.dll).

---

**Desktop**
Download a desktop build, for example:

- Windows: [tswui-0.1.0-rc.9-windows-amd64.exe](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.9/tswui-0.1.0-rc.9-windows-amd64.exe)
- macOS: [tswui-0.1.0-rc.9-darwin-arm64](https://github.com/hufang360/TShockWebUI/releases/download/v0.1.0-rc.9/tswui-0.1.0-rc.9-darwin-arm64)
Double-click to start; a console window opens — keep it open!
(This executable bundles the frontend build, `data/*.json` and the atlases; no Node.js or other runtime is needed.)
Then open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.
**Web**

- Add a TShock server: enter your server IP, and leave the `7878` REST API port next to it unchanged in most cases.
- Log in to TShock with your in-game player name and password. If you forgot your password, ask the server owner to reset it: `/user password <username> <new password>`.

---

## Public deployment

**Static site**
Tools such as item IDs, data IDs, the command cheat sheet, and the player/world save viewers work without logging in!
If you only need these tools, visit: [hufang360.github.io/TShockWebUI/](https://hufang360.github.io/TShockWebUI/)
This page has no Go backend and cannot communicate with a TShock server.
**Docker**

```bash
# Pull the image
# docker pull hufang360/tshockwebui:0.1.0-rc.9
docker pull ghcr.io/hufang360/tshockwebui:0.1.0-rc.9

# Start the container
# http://<server-ip>:18080
# On Linux, if host.docker.internal cannot be resolved, add
#   --add-host host.docker.internal:host-gateway
# or replace TSHOCK_URL with the host's IP.
docker run -d --name tswui -p 18080:8080 \
  -e TSHOCK_URL=http://host.docker.internal:7878 \
  -e TSHOCK_ALLOW_CUSTOM_TARGETS=true \
  ghcr.io/hufang360/tshockwebui:0.1.0-rc.9
```

## Architecture

```text
Browser (React SPA; production base=/, Pages demo under a subpath)
  ├─ Static assets  /assets/*  /data/*        ← served by the embedded Go binary
  ├─ Local memory   localStorage (no token)
  └─ Same-origin API /api/*                   ← the only backend endpoint
                     │
                     ▼
Single-container image (~20MB, distroless)
  └─ Go backend (Go 1.27, standard library only)
       ├─ Static asset serving (embedded webdist)
       ├─ In-memory sessions + HttpOnly cookie (holds the TShock token)
       ├─ Tier A pre-checks (embedded commands.json)
       └─ TShock client → env TSHOCK_URL
                     │
                     ▼
TShock REST API (default http://127.0.0.1:7878; on a same-network compose setup use http://tshock:7878)
```

- **Only fixed `/api/*` endpoints are exposed**; there is no generic `/tshock/` proxy.
- The TShock token only appears in outbound "backend → TShock" requests; it never appears in response bodies, URLs or logs.
- The backend probes TShock `server/status` through `/api/status`; the frontend compares the result with `gameVersion` in `data/meta.json` and warns on a mismatch.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Local development

### Backend (`server/`, Go 1.27, standard library)

```bash
cd web && npm install && npm run build        # frontend build

cd ../server
WEB_DIST_DIR=../web/dist TSHOCK_URL=http://127.0.0.1:7878 go run .   # :8080

go vet ./... && go test -race ./...
```

### Frontend (`web/`, React 19 + Vite + TS + Tailwind)

```bash
cd web
npm install
npm run dev          # http://localhost:5173; /api is proxied to VITE_API_TARGET (default :8080)
npm run build        # output in web/dist/
npm run typecheck && npm run lint && npm run test:run
```

For UI work, prefer `make dev-web` from the repository root: Vite with HMR runs on `:5173` and proxies `/api` to the backend on `:18080`.
If you do not want two terminals, use **`make dev-all`** (starts the container backend and Vite automatically). The container backend already listens on `:18080`, so opening
`http://localhost:18080` gives you the full app (existing dist, no HMR).
See [`docs/开发速查.md`](docs/开发速查.md) for details.

For a frontend-only demo without a backend (the UI is explicitly marked **Mock**):

```bash
VITE_TRANSPORT=mock npm run dev
```

### Scripts

```bash
scripts/dev-native.sh                # run the backend directly on the host (bypass container networking/proxy)
BUILD_WEB=1 scripts/dev-native.sh    # build the frontend first, then start
scripts/build-binary.sh              # build a single-file binary (frontend + data embedded); no Docker/Node needed to run
SMOKE=1 scripts/build-binary.sh      # same, with a smoke test after building
VERSION=1.2.3 scripts/build-binary.sh    # set the version (default: git describe)
scripts/dev-container.sh             # build on the host + mount into a distroless container for fast iteration
scripts/dev-container.sh frontend    # rebuild the frontend only; just refresh the browser
scripts/dev-container.sh backend     # rebuild the backend and restart the container
scripts/run-container.sh             # build the real image and run it (delivery verification)
TSWUI_TOKEN=... server/scripts/smoke.sh   # end-to-end smoke test against a running backend
```

---

## Copyright

Item icons and game data are copyright **Re-Logic**. This repository includes atlas PNGs generated from local game resources, used only with this project.
