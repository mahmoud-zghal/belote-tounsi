# Belote Tounsi Multiplayer + APK Plan

## P0 (Tonight) — Working room backend scaffold
- Node + Socket.IO room server
- Create room / join room / start game (host only)
- Seat lock for 4 players
- Turn broadcast events

Status: ✅ Scaffold created in `server/`

## P1 — Authoritative game engine on server
- Move game rules/scoring into shared engine
- Server validates legal moves
- Server sends private hand per player + public table state
- Deterministic turn progression

## P2 — Production networking
- Reconnect token per player
- Timeout + auto pass logic
- Match resume support
- Basic anti-cheat checks

## P3 — Persistence and accounts
- Postgres for users/matches/stats
- Redis for room/session state
- Guest login + optional account linking

## P4 — Android APK
- Wrap web client with Capacitor
- Android signing config
- Internal testing release
- Play Console closed testing

---

## Quick local run (server)
```bash
cd server
npm install
npm run dev
```
Server health: `http://localhost:8787/health`

## Socket events (initial)
- `room:create {name}`
- `room:join {code,name}`
- `game:start`
- `game:play-card {card}`
- broadcasts: `room:update`, `game:started`, `game:card-played`
