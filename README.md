# AXIS Command Center

Corridor control layer for the Nyinahin–Takoradi bauxite haulage project. Multi-hauler aggregation platform for NewCo Logistics JV Ltd. (trading as AXIS).

Read `BRIEF.md` before anything else. The build journal — what shipped in
each phase, with the wrap-up reports — lives in `PHASES.md`.

## Local development

Two processes. Run in separate terminals.

```bash
# Terminal 1 — bridge server (port 3002)
cd server
npm install
npm run dev

# Terminal 2 — client (port 5174)
cd client
npm install
npm run dev
```

Then open http://localhost:5174.

The Vite dev server proxies `/api/*` to the bridge on port 3002.

## Environment

Both processes are demo-mode by default. No env vars required to boot.

Server:
- `PORT` — override bridge port (default 3002)
- `AXIS_LIVE_MODE` — any truthy value disables the demo banner

Client: no env vars in v1.

## Phase status

See `BRIEF.md §11` for the phase plan and `PHASES.md` for the build journal —
each entry is the wrap-up report from when that phase shipped. The most
recent phase is at the bottom.
