# Tic-Tac-Toe

A responsive Tic-Tac-Toe web app with three ways to play:

- **2 Players** — local pass-and-play on the same screen.
- **Vs AI** — play against a basic AI (Easy = random moves, Hard = unbeatable minimax).
- **Online** — real-time multiplayer against someone else, anywhere, using a shareable room code.

The UI is built with plain **HTML, CSS, and Vanilla JavaScript** (no frameworks, no build step). Online multiplayer is powered by a small **Node.js + Express + Socket.IO** server, with **Neon (serverless Postgres)** used to persist player profiles, scores, and match history.

## Project structure

```
tictactoegame/
├── public/
│   ├── index.html     # App markup (board, mode tabs, online panel, leaderboard)
│   ├── style.css       # All styling
│   └── script.js       # Client logic: local, AI, and online modes
├── server.js           # Express + Socket.IO server (REST API + realtime game rooms)
├── db.js               # Neon/Postgres persistence layer (players, match history)
├── package.json
├── .env.example         # Template for environment variables
└── .gitignore
```

## Features

- **Local 2-player mode** — pass-and-play on one device, no server needed.
- **AI opponent mode** — Easy (random) or Hard (minimax, unbeatable) difficulty.
- **Online multiplayer** — create a room, share the 5-character code with a friend, and play live from different devices/locations. Moves sync instantly via WebSockets (Socket.IO).
- **Persistent profiles, scores, and history**:
  - Local/AI mode stats are saved in the browser's `localStorage` — no server required.
  - Online mode stats (wins/losses/draws) and match history are saved in your **Neon Postgres** database, so your online record persists across sessions and devices.
- **Leaderboard** — top online players by wins, pulled from Neon.
- Choose your symbol, who starts first, and restart/rematch at any time.
- Fully responsive layout for desktop and mobile.
- **Graceful degradation** — if you don't configure a database, local/AI modes work exactly the same, and online multiplayer still works for live play; only the persisted leaderboard/history features are unavailable (the UI shows a friendly message instead of crashing).

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (for the online multiplayer server).
- A free [Neon](https://neon.tech/) Postgres database (optional, but needed for leaderboard/match history persistence).

> If you only want local pass-and-play or Vs AI, you can skip Node.js entirely and just open `public/index.html` directly in your browser — those modes are 100% client-side.

## Quick start

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **(Optional but recommended) Configure your Neon database** — see [Setting up Neon](#setting-up-neon) below.

3. **Start the server**

   ```bash
   npm start
   ```

   For development with auto-restart on file changes, use:

   ```bash
   npm run dev
   ```

4. Open your browser at **http://localhost:3000**.

5. To play online with someone else, share your public URL (see [Playing with someone remotely](#playing-with-someone-remotely-deployment)) and have them join using your room code.

## Setting up Neon

[Neon](https://neon.tech/) is a serverless Postgres provider with a generous free tier — a great fit here because the app only needs to persist small amounts of data (player profiles and match results), while all live gameplay happens over Socket.IO in memory.

1. Create a free account and a new project at [neon.tech](https://neon.tech/).
2. In your Neon project dashboard, go to **Connection Details** and copy the **pooled connection string** (recommended for serverless/short-lived connections). It looks like:

   ```
   postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<dbname>?sslmode=require
   ```

3. Copy `.env.example` to a new file named `.env`:

   ```bash
   cp .env.example .env
   ```

4. Paste your connection string into `.env`:

   ```
   DATABASE_URL=postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<dbname>?sslmode=require
   PORT=3000
   ```

5. Start (or restart) the server. On boot, `server.js` calls `db.initSchema()`, which automatically creates the two tables it needs (`players` and `matches`) if they don't already exist — **no manual SQL or migrations needed**.

If `DATABASE_URL` is missing or invalid, the server logs a warning but keeps running: local/AI modes and live online play still work, but the leaderboard and match-history panels will show "unavailable" messages instead of data.

## Environment variables

| Variable       | Required | Description                                                                 |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL` | No*      | Neon/Postgres connection string. Needed for leaderboard and match history.    |
| `PORT`         | No       | Port the server listens on. Defaults to `3000`.                               |

\* Not required for the server to start or for live online gameplay, but required for persisted stats/history/leaderboard.

## How online multiplayer works

- One player clicks **Create Room**, which generates a short, easy-to-share 5-character room code (ambiguous characters like `0`/`O` and `1`/`I` are excluded).
- The other player enters that code and clicks **Join** to connect to the same room from anywhere with an internet connection.
- Moves are sent over a WebSocket connection (via [Socket.IO](https://socket.io/)) and broadcast to both players instantly — the server is the source of truth for whose turn it is and who has won.
- When a game ends, the result is saved to Neon (`matches` table) and each player's cumulative wins/losses/draws are updated (`players` table).
- The **Online Leaderboard** and **Your Online Matches** panels read this data back via a small REST API (`/api/leaderboard`, `/api/players/:id/history`).
- Click **Rematch** to play again in the same room, or **Leave Room** to disconnect.

### Player identity

There's no sign-up/login system. The first time you use Online mode, the app generates a random player ID and stores it in your browser's `localStorage`. This ID is what ties your wins/losses/history together in Neon. That means:

- Your online stats are tied to **this browser on this device**, not a universal account.
- Playing from a different browser or device (or clearing site data) will start a fresh online identity.
- Your display name can be changed any time in the Online panel; your historical stats stay linked to your ID, not your name.

### Known limitations

- **No reconnect support** — if you refresh the page or lose connection mid-game, you're removed from the room and your opponent is notified. Simply create/join a new room to continue.
- **No spectators or private messaging** — it's a focused 1v1 game room.
- **No authentication** — identity is a browser-generated ID, not a verified account (see above).

## Playing with someone remotely (deployment)

To let someone outside your local network join a room, the server needs to be reachable over the internet. Running it only on `localhost` means only people on your machine can connect. Options:

- Deploy `server.js` to any Node-friendly host (e.g. Render, Railway, Fly.io, a VPS, etc.), set the `DATABASE_URL` and `PORT` environment variables there, and share the deployed URL.
- Or use a tunneling tool (e.g. `ngrok http 3000`) to temporarily expose your local server for testing.

Wherever you deploy, make sure the `DATABASE_URL` environment variable is set on that host too (copy it from your `.env`) so the leaderboard and match history work in production.

## Local development without Node

If you just want to play locally or against the AI without installing anything, open `public/index.html` directly in your browser. The Online tab will show a "server not available" state (since there's no Socket.IO server running), but 2 Players and Vs AI modes work fully offline, with scores/history saved to `localStorage`.

## Scripts

| Command         | Description                                      |
| ---------------- | ------------------------------------------------- |
| `npm install`     | Install dependencies.                             |
| `npm start`        | Start the server (`server.js`) on `PORT` (default 3000). |
| `npm run dev`       | Start the server with `nodemon` for auto-reload during development. |

## Tech stack

- Frontend: HTML5, CSS3, Vanilla JavaScript
- Backend: Node.js, Express, Socket.IO
- Database: Neon (serverless Postgres), accessed via the `pg` driver
