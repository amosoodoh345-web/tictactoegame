/* =======================================================================
   db.js — Neon (serverless Postgres) persistence layer.

   This module is the only place that talks to the database. It exposes
   small, purpose-built helper functions used by server.js so that the
   rest of the app never has to write SQL directly.

   Connection:
     Reads the connection string from process.env.DATABASE_URL, which you
     get from your Neon project dashboard (Connection Details -> copy the
     "pooled connection" string). See README.md for setup instructions.
   ======================================================================= */

'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db] DATABASE_URL is not set. Online mode will not be able to save ' +
    'profiles, scores, or match history. See README.md to configure Neon.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requires SSL. `rejectUnauthorized: false` keeps this working with
  // Neon's managed certificates without needing to vendor a CA bundle.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  // Idle client errors (e.g. dropped connections) should not crash the server.
  console.error('[db] Unexpected error on idle Postgres client', err);
});

/**
 * Creates the tables used by the app if they do not already exist.
 * Safe to call every time the server starts.
 */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      room_code TEXT NOT NULL,
      player_x_id UUID,
      player_x_name TEXT,
      player_o_id UUID,
      player_o_name TEXT,
      winner TEXT, -- 'X' | 'O' | 'draw'
      played_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/** Creates a player row if it doesn't exist yet, or refreshes its display name. */
async function upsertPlayer(id, name) {
  const result = await pool.query(
    `INSERT INTO players (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id, name, wins, losses, draws`,
    [id, name]
  );
  return result.rows[0];
}

/** Fetches a single player's profile (wins/losses/draws) by id. */
async function getPlayer(id) {
  const result = await pool.query(
    `SELECT id, name, wins, losses, draws FROM players WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Records a finished online match and updates both players' tallies.
 * `winner` is 'X', 'O', or 'draw'.
 */
async function recordMatch({ roomCode, playerX, playerO, winner }) {
  await pool.query(
    `INSERT INTO matches
       (room_code, player_x_id, player_x_name, player_o_id, player_o_name, winner)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [roomCode, playerX.id, playerX.name, playerO.id, playerO.name, winner]
  );

  if (winner === 'draw') {
    await pool.query(
      `UPDATE players SET draws = draws + 1, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [[playerX.id, playerO.id]]
    );
    return;
  }

  const winnerId = winner === 'X' ? playerX.id : playerO.id;
  const loserId = winner === 'X' ? playerO.id : playerX.id;
  await pool.query(`UPDATE players SET wins = wins + 1, updated_at = now() WHERE id = $1`, [winnerId]);
  await pool.query(`UPDATE players SET losses = losses + 1, updated_at = now() WHERE id = $1`, [loserId]);
}

/** Returns the most recent online matches a given player took part in. */
async function getRecentMatchesForPlayer(playerId, limit = 20) {
  const result = await pool.query(
    `SELECT id, room_code, player_x_name, player_o_name, winner, played_at
     FROM matches
     WHERE player_x_id = $1 OR player_o_id = $1
     ORDER BY played_at DESC
     LIMIT $2`,
    [playerId, limit]
  );
  return result.rows;
}

/** Returns the top players ranked by wins (then draws) for the leaderboard. */
async function getLeaderboard(limit = 10) {
  const result = await pool.query(
    `SELECT name, wins, losses, draws
     FROM players
     WHERE wins + losses + draws > 0
     ORDER BY wins DESC, draws DESC, losses ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

module.exports = {
  pool,
  initSchema,
  upsertPlayer,
  getPlayer,
  recordMatch,
  getRecentMatchesForPlayer,
  getLeaderboard
};
