const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    })
  : null;

async function init() {
  if (!pool) {
    console.warn('[db] DATABASE_URL not set — game history will not be persisted.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      total_score INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS answers (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      round_index INTEGER NOT NULL,
      vocab_id TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      grade TEXT NOT NULL,
      points INTEGER NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vocab_entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term TEXT NOT NULL,
      meaning TEXT NOT NULL,
      example TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('[db] schema ready');
}

async function saveFinishedSession({ code, players, answersFlat }) {
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionRes = await client.query(
      'INSERT INTO sessions (code) VALUES ($1) RETURNING id',
      [code]
    );
    const sessionId = sessionRes.rows[0].id;

    const dbPlayerIdByTempId = new Map();
    for (const player of players) {
      const playerRes = await client.query(
        'INSERT INTO players (session_id, name, total_score) VALUES ($1, $2, $3) RETURNING id',
        [sessionId, player.name, player.totalScore]
      );
      dbPlayerIdByTempId.set(player.tempId, playerRes.rows[0].id);
    }

    for (const answer of answersFlat) {
      const dbPlayerId = dbPlayerIdByTempId.get(answer.playerId);
      if (!dbPlayerId) continue;
      await client.query(
        `INSERT INTO answers (session_id, player_id, round_index, vocab_id, answer_text, grade, points)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sessionId, dbPlayerId, answer.roundIndex, answer.vocabId, answer.text, answer.grade, answer.points]
      );
    }

    await client.query('COMMIT');
    return sessionId;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db] failed to save session history', err);
    return null;
  } finally {
    client.release();
  }
}

module.exports = { init, saveFinishedSession, pool };
