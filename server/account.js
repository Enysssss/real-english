const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[account] JWT_SECRET not set — using an insecure dev default. Set it on Railway.');
}

const COOKIE_NAME = 'carnet_token';
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });
}

function setAuthCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: COOKIE_MAX_AGE,
  });
}

function attachUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, username: payload.username };
  } catch (err) {
    // expired/invalid token — treat as anonymous rather than erroring
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Tu dois être connecté.' });
  next();
}

function requireDb(req, res, next) {
  if (!db.pool) return res.status(503).json({ error: "Compte indisponible : pas de base de données configurée." });
  next();
}

router.use(attachUser);

router.get('/auth/me', (req, res) => {
  res.json({ user: req.user ? { username: req.user.username } : null });
});

router.post('/auth/signup', requireDb, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 2 || username.length > 24) {
    return res.status(400).json({ error: 'Le pseudo doit faire entre 2 et 24 caractères.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 4 caractères.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    const user = result.rows[0];
    setAuthCookie(req, res, signToken(user));
    res.json({ username: user.username });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
    }
    console.error('[account] signup failed', err);
    res.status(500).json({ error: "Erreur lors de la création du compte." });
  }
});

router.post('/auth/login', requireDb, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  try {
    const result = await db.pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
    setAuthCookie(req, res, signToken(user));
    res.json({ username: user.username });
  } catch (err) {
    console.error('[account] login failed', err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({});
});

router.get('/carnet', requireDb, requireAuth, async (req, res) => {
  const result = await db.pool.query(
    'SELECT id, term, meaning, example, created_at FROM vocab_entries WHERE user_id = $1 ORDER BY created_at ASC',
    [req.user.id]
  );
  res.json({
    entries: result.rows.map((r) => ({
      id: r.id,
      term: r.term,
      meaning: r.meaning,
      example: r.example || '',
      createdAt: new Date(r.created_at).getTime(),
    })),
  });
});

router.post('/carnet', requireDb, requireAuth, async (req, res) => {
  const term = String(req.body.term || '').trim().slice(0, 200);
  const meaning = String(req.body.meaning || '').trim().slice(0, 300);
  const example = String(req.body.example || '').trim().slice(0, 500);
  if (!term || !meaning) {
    return res.status(400).json({ error: 'Le mot et le sens sont obligatoires.' });
  }
  const result = await db.pool.query(
    'INSERT INTO vocab_entries (user_id, term, meaning, example) VALUES ($1,$2,$3,$4) RETURNING id, term, meaning, example, created_at',
    [req.user.id, term, meaning, example]
  );
  const r = result.rows[0];
  res.json({ id: r.id, term: r.term, meaning: r.meaning, example: r.example || '', createdAt: new Date(r.created_at).getTime() });
});

router.delete('/carnet/:id', requireDb, requireAuth, async (req, res) => {
  const result = await db.pool.query('DELETE FROM vocab_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Mot introuvable.' });
  res.json({});
});

module.exports = router;
