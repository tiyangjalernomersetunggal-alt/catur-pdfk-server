require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const { Chess } = require('chess.js');

// Mengambil PORT dari Railway (yang bernilai 8080), atau fallback ke 8080
const PORT = process.env.PORT || 8080;

// Tambahkan '0.0.0.0' agar Railway bisa mengakses container
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Catur berjalan di port ${PORT}`);
});
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ganti-password-admin-ini';
const SESSION_SECRET = process.env.SESSION_SECRET || 'ganti-dengan-string-acak-panjang';

if (ADMIN_PASSWORD === 'ganti-password-admin-ini') {
  console.warn('[PERINGATAN] ADMIN_PASSWORD masih default. Ganti lewat file .env / Environment Variables sebelum dipakai beneran.');
}

const app = express();
app.set('trust proxy', 1); // perlu untuk deploy di belakang proxy Render/Railway/dll
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true }
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

/* ================= DATABASE ================= */
// SQLite file lokal. CATATAN: kalau host-nya punya disk yang di-reset saat redeploy
// (mis. Render free tier tanpa "Disk"), data pendaftar/skor bisa hilang saat redeploy.
// Lihat README untuk cara menambahkan persistent disk di Render.
const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    token_sent INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS scores (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0
  );
`);

function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 6; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

function getLeaderboard() {
  return db.prepare('SELECT name, wins, losses, draws, points FROM scores ORDER BY points DESC, wins DESC LIMIT 30').all();
}

function broadcastLeaderboard() {
  io.emit('leaderboard:update', getLeaderboard());
}

function applyScore(token, outcome) {
  const row = db.prepare('SELECT * FROM scores WHERE token=?').get(token);
  if (!row) return;
  let { wins, losses, draws, points } = row;
  if (outcome === 'win') { wins += 1; points += 10; }
  else if (outcome === 'loss') { losses += 1; }
  else { draws += 1; points += 3; }
  db.prepare('UPDATE scores SET wins=?, losses=?, draws=?, points=? WHERE token=?').run(wins, losses, draws, points, token);
}

/* ================= PUBLIC REST API ================= */
app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const phone = String(req.body.phone || '').trim().slice(0, 30);
  if (!name || !phone) return res.status(400).json({ error: 'Nama dan nomor WhatsApp wajib diisi.' });

  let token;
  do { token = genToken(); } while (db.prepare('SELECT 1 FROM users WHERE token=?').get(token));

  const now = Date.now();
  db.prepare('INSERT INTO users (token,name,phone,created_at,token_sent) VALUES (?,?,?,?,0)').run(token, name, phone, now);
  db.prepare('INSERT INTO scores (token,name,wins,losses,draws,points) VALUES (?,?,0,0,0,0)').run(token, name);
  broadcastLeaderboard();
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const token = String(req.body.token || '').trim().toUpperCase();
  const u = db.prepare('SELECT * FROM users WHERE token=?').get(token);
  if (!u) return res.status(404).json({ error: 'Token tidak ditemukan.' });
  res.json({ ok: true, token: u.token, name: u.name });
});

app.get('/api/leaderboard', (req, res) => {
  res.json(getLeaderboard());
});

/* ================= ADMIN API ================= */
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Belum login admin.' });
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Password salah.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get('/api/admin/registrations', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT token, name, phone, created_at, token_sent FROM users ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/admin/mark-sent', requireAdmin, (req, res) => {
  const { token } = req.body;
  db.prepare('UPDATE users SET token_sent=1 WHERE token=?').run(token);
  res.json({ ok: true });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

/* ================= LIVE / REALTIME STATE (in-memory) ================= */
const online = new Map();            // token -> { socketId, name, status }
const pendingChallenges = new Map(); // targetToken -> { fromToken, fromName, minutes, timeout }
const queue = new Map();             // token -> { name, minutes }
const games = new Map();             // gameId -> game state
const disconnectTimers = new Map();  // token -> Timeout

function getSocket(token) {
  const info = online.get(token);
  if (!info) return null;
  return io.sockets.sockets.get(info.socketId) || null;
}

function broadcastPresence() {
  const list = [...online.entries()].map(([token, v]) => ({ token, name: v.name, status: v.status }));
  io.emit('presence:update', list);
}

function genGameId() {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function startGame(tokenA, nameA, tokenB, nameB, minutes) {
  const gameId = genGameId();
  const whiteIsA = Math.random() < 0.5;
  const white = whiteIsA ? tokenA : tokenB, whiteName = whiteIsA ? nameA : nameB;
  const black = whiteIsA ? tokenB : tokenA, blackName = whiteIsA ? nameB : nameA;
  const bank = (minutes || 5) * 60000;
  const chess = new Chess();

  const g = {
    gameId, white, whiteName, black, blackName, chess,
    whiteMs: bank, blackMs: bank, turnStartedAt: Date.now(),
    minutes: minutes || 5, status: 'active'
  };
  games.set(gameId, g);
  g.interval = setInterval(() => checkTimeout(gameId), 1000);

  [
    [white, 'w', blackName],
    [black, 'b', whiteName]
  ].forEach(([tok, color, oppName]) => {
    const sock = getSocket(tok);
    if (sock) {
      sock.data.gameId = gameId;
      sock.emit('game:start', {
        gameId, color, opponentName: oppName, minutes: g.minutes,
        fen: chess.fen(), whiteMs: g.whiteMs, blackMs: g.blackMs,
        turn: chess.turn(), turnStartedAt: g.turnStartedAt
      });
    }
    if (online.has(tok)) online.get(tok).status = 'in-game';
  });
  broadcastPresence();
}

function checkTimeout(gameId) {
  const g = games.get(gameId);
  if (!g || g.status !== 'active') return;
  const elapsed = Date.now() - g.turnStartedAt;
  const turnColor = g.chess.turn();
  const remaining = (turnColor === 'w' ? g.whiteMs : g.blackMs) - elapsed;
  if (remaining <= 0) {
    endGame(gameId, turnColor === 'w' ? 'black' : 'white', 'waktu habis');
  }
}

function endGame(gameId, winnerColor, reason) {
  const g = games.get(gameId);
  if (!g || g.status === 'finished') return;
  g.status = 'finished';
  clearInterval(g.interval);

  if (winnerColor === 'draw') {
    applyScore(g.white, 'draw');
    applyScore(g.black, 'draw');
  } else {
    const winnerToken = winnerColor === 'white' ? g.white : g.black;
    const loserToken = winnerColor === 'white' ? g.black : g.white;
    applyScore(winnerToken, 'win');
    applyScore(loserToken, 'loss');
  }
  broadcastLeaderboard();

  [g.white, g.black].forEach((tok) => {
    const sock = getSocket(tok);
    if (sock) {
      sock.data.gameId = null;
      sock.emit('game:over', { winnerColor, reason, fen: g.chess.fen() });
    }
    if (online.has(tok)) online.get(tok).status = 'online';
  });
  broadcastPresence();
  setTimeout(() => games.delete(gameId), 30000);
}

function matchQueue() {
  const entries = [...queue.entries()];
  while (entries.length >= 2) {
    const [tokenA, a] = entries.shift();
    const [tokenB, b] = entries.shift();
    queue.delete(tokenA);
    queue.delete(tokenB);
    startGame(tokenA, a.name, tokenB, b.name, a.minutes || b.minutes || 5);
  }
}

io.on('connection', (socket) => {
  socket.on('auth', ({ token }) => {
    const u = db.prepare('SELECT * FROM users WHERE token=?').get(String(token || '').toUpperCase());
    if (!u) { socket.emit('error:message', { text: 'Token tidak valid.' }); return; }
    socket.data.token = u.token;
    socket.data.name = u.name;

    if (disconnectTimers.has(u.token)) {
      clearTimeout(disconnectTimers.get(u.token));
      disconnectTimers.delete(u.token);
    }

    // reconnect ke game yang sedang berjalan (kalau ada)
    let resumedGame = null;
    for (const [gid, g] of games) {
      if (g.status === 'active' && (g.white === u.token || g.black === u.token)) {
        resumedGame = { gid, g };
        break;
      }
    }

    online.set(u.token, { socketId: socket.id, name: u.name, status: resumedGame ? 'in-game' : 'online' });
    broadcastPresence();
    socket.emit('auth:ok', { name: u.name, token: u.token });

    if (resumedGame) {
      const { gid, g } = resumedGame;
      socket.data.gameId = gid;
      const color = g.white === u.token ? 'w' : 'b';
      const oppName = color === 'w' ? g.blackName : g.whiteName;
      socket.emit('game:start', {
        gameId: gid, color, opponentName: oppName, minutes: g.minutes,
        fen: g.chess.fen(), whiteMs: g.whiteMs, blackMs: g.blackMs,
        turn: g.chess.turn(), turnStartedAt: g.turnStartedAt, resumed: true
      });
    }
  });

  socket.on('challenge:send', ({ targetToken, minutes }) => {
    const from = socket.data.token;
    if (!from || from === targetToken) return;
    const targetInfo = online.get(targetToken);
    if (!targetInfo || targetInfo.status === 'in-game') {
      socket.emit('challenge:rejected', { reason: 'unavailable' });
      return;
    }
    const targetSock = getSocket(targetToken);
    if (!targetSock) return;
    if (pendingChallenges.has(targetToken)) {
      socket.emit('challenge:rejected', { reason: 'busy' });
      return;
    }
    const rec = { fromToken: from, fromName: socket.data.name, minutes: minutes || 5 };
    rec.timeout = setTimeout(() => {
      pendingChallenges.delete(targetToken);
      const fromSock = getSocket(from);
      if (fromSock) fromSock.emit('challenge:rejected', { reason: 'timeout' });
    }, 25000);
    pendingChallenges.set(targetToken, rec);
    targetSock.emit('challenge:incoming', { fromName: rec.fromName, minutes: rec.minutes });
  });

  socket.on('challenge:respond', ({ accept }) => {
    const me = socket.data.token;
    const rec = pendingChallenges.get(me);
    if (!rec) return;
    clearTimeout(rec.timeout);
    pendingChallenges.delete(me);
    if (accept) {
      startGame(rec.fromToken, rec.fromName, me, socket.data.name, rec.minutes);
    } else {
      const fromSock = getSocket(rec.fromToken);
      if (fromSock) fromSock.emit('challenge:rejected', { reason: 'declined' });
    }
  });

  socket.on('queue:join', ({ minutes }) => {
    const me = socket.data.token;
    if (!me || socket.data.gameId) return;
    queue.set(me, { name: socket.data.name, minutes: minutes || 5 });
    matchQueue();
  });

  socket.on('queue:leave', () => {
    if (socket.data.token) queue.delete(socket.data.token);
  });

  socket.on('game:move', ({ gameId, from, to, promotion }) => {
    const g = games.get(gameId);
    const me = socket.data.token;
    if (!g || g.status !== 'active') return;
    const color = g.white === me ? 'w' : g.black === me ? 'b' : null;
    if (!color || g.chess.turn() !== color) return;

    const elapsed = Date.now() - g.turnStartedAt;
    const mv = g.chess.move({ from, to, promotion: promotion || 'q' });
    if (!mv) { socket.emit('error:message', { text: 'Langkah tidak sah.' }); return; }

    if (color === 'w') g.whiteMs -= elapsed; else g.blackMs -= elapsed;
    g.turnStartedAt = Date.now();

    [g.white, g.black].forEach((tok) => {
      const s = getSocket(tok);
      if (s) s.emit('game:update', {
        fen: g.chess.fen(), turn: g.chess.turn(), whiteMs: g.whiteMs, blackMs: g.blackMs,
        turnStartedAt: g.turnStartedAt, lastMoveSan: mv.san
      });
    });

    if (g.chess.game_over()) {
      let winnerColor = 'draw';
      let reason = 'remis';
      if (g.chess.in_checkmate()) { winnerColor = color; reason = 'skakmat'; }
      endGame(gameId, winnerColor, reason);
    }
  });

  socket.on('game:resign', ({ gameId }) => {
    const g = games.get(gameId);
    const me = socket.data.token;
    if (!g || g.status !== 'active') return;
    const winnerColor = g.white === me ? 'black' : 'white';
    endGame(gameId, winnerColor, 'menyerah');
  });

  socket.on('chat:send', ({ gameId, text }) => {
    const g = games.get(gameId);
    const me = socket.data.token;
    if (!g || !text) return;
    const clean = String(text).slice(0, 140);
    if (!clean.trim()) return;
    const payload = { gameId, from: me, name: socket.data.name, text: clean, at: Date.now() };
    [g.white, g.black].forEach((tok) => {
      const s = getSocket(tok);
      if (s) s.emit('chat:message', payload);
    });
  });

  socket.on('disconnect', () => {
    const token = socket.data.token;
    if (!token) return;
    if (online.get(token)?.socketId === socket.id) online.delete(token);
    queue.delete(token);
    broadcastPresence();

    const gid = socket.data.gameId;
    if (gid) {
      const g = games.get(gid);
      if (g && g.status === 'active') {
        const t = setTimeout(() => {
          const stillActive = games.get(gid);
          if (stillActive && stillActive.status === 'active') {
            const winnerColor = stillActive.white === token ? 'black' : 'white';
            endGame(gid, winnerColor, 'lawan terputus');
          }
          disconnectTimers.delete(token);
        }, 45000);
        disconnectTimers.set(token, t);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('Papan Kantor server jalan di port ' + PORT);
});
