// TollyDraw server: Express + Socket.IO. Drawasaurus-style draw & guess, Telugu movie titles.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const WORDS = require('./words.json');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/r/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- helpers ----------
const MAX_PLAYERS = 12;
const CHOOSE_MS = 15000;
const TURN_END_MS = 6000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Phonetic-ish key so Telugu spelling variants match: Bahubali/Baahubali, Srimanthudu/Shreemanthudu...
function key(s) {
  let k = norm(s);
  k = k.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/sh/g, 's').replace(/ph/g, 'f')
    .replace(/(k|g|t|d|b|c|j|p)h/g, '$1').replace(/w/g, 'v').replace(/z/g, 'j').replace(/y(?=[aeiou])/g, 'y');
  return k.replace(/(.)\1+/g, '$1');
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const rnd = n => Math.floor(Math.random() * n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

for (const w of WORDS) { w.keys = w.answers.map(key); w.keys.push(key(w.word)); w.nkeys = w.answers.map(norm); }

const rooms = new Map();
function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function newRoom(isPublic) {
  const room = {
    code: makeCode(), public: !!isPublic, players: new Map(), hostId: null,
    settings: { rounds: 3, drawTime: 80, pool: 'popular' },
    state: 'lobby', round: 0, order: [], turnIdx: -1, drawerId: null,
    word: null, wordObj: null, choices: [], ops: [], hintMask: [], turnStart: 0, turnMs: 0,
    gains: {}, timers: {}, used: new Set(),
  };
  rooms.set(room.code, room);
  return room;
}

const pub = p => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed, color: p.color });
const AVATARS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#9b5de5', '#f15bb5', '#00a6a6', '#8ac926', '#ff7f11', '#3a86ff', '#6a994e', '#d62828'];

function roomState(room) {
  return {
    code: room.code, state: room.state, hostId: room.hostId, settings: room.settings, round: room.round,
    drawerId: room.drawerId, players: [...room.players.values()].map(pub),
  };
}
const emitRoom = room => io.to(room.code).emit('room', roomState(room));
const sys = (room, text, kind = 'sys') => io.to(room.code).emit('chat', { kind, text });
function clearTimers(room) { for (const k of Object.keys(room.timers)) { clearTimeout(room.timers[k]); clearInterval(room.timers[k]); } room.timers = {}; }

function hintString(room) {
  return room.word.split('').map((ch, i) => (/[A-Za-z0-9]/.test(ch) ? (room.hintMask[i] ? ch : '_') : ch)).join('');
}
const remainingMs = room => Math.max(0, room.turnMs - (Date.now() - room.turnStart));

// ---------- game flow ----------
function startGame(room) {
  clearTimers(room);
  for (const p of room.players.values()) { p.score = 0; p.guessed = false; }
  room.round = 1; room.used = new Set(); room.turnIdx = -1; room.ops = [];
  room.order = [...room.players.keys()];
  sys(room, 'Game started! Get drawing 🎬');
  nextTurn(room);
}

function nextTurn(room) {
  clearTimers(room);
  room.turnIdx++;
  // find next present drawer in this round's order
  while (room.turnIdx < room.order.length && !room.players.has(room.order[room.turnIdx])) room.turnIdx++;
  if (room.turnIdx >= room.order.length) {
    room.round++;
    if (room.round > room.settings.rounds) return endGame(room);
    room.order = [...room.players.keys()];
    room.turnIdx = -1;
    return nextTurn(room);
  }
  if (room.players.size < 2) return backToLobby(room, 'Not enough players. Back to lobby.');
  const drawerId = room.order[room.turnIdx];
  room.drawerId = drawerId; room.state = 'choosing'; room.ops = []; room.word = null; room.wordObj = null; room.gains = {};
  for (const p of room.players.values()) p.guessed = false;

  // 3 choices: popularity-weighted tiers
  const pool = WORDS.filter(w => (room.settings.pool === 'all' || w.tier !== 'hard') && !room.used.has(w.word));
  const source = pool.length >= 3 ? pool : WORDS;
  room.choices = shuffle(source.slice()).slice(0, 3);

  emitRoom(room);
  io.to(room.code).emit('turn:choosing', { drawerId, round: room.round, rounds: room.settings.rounds, ms: CHOOSE_MS });
  io.to(drawerId).emit('turn:choices', room.choices.map(w => ({ word: w.word, tier: w.tier })));
  io.to(room.code).emit('canvas:clear');
  room.timers.choose = setTimeout(() => pickWord(room, rnd(3)), CHOOSE_MS);
}

function pickWord(room, idx) {
  if (room.state !== 'choosing') return;
  const w = room.choices[idx]; if (!w) return;
  clearTimeout(room.timers.choose);
  room.wordObj = w; room.word = w.word; room.used.add(w.word);
  room.hintMask = room.word.split('').map(() => false);
  room.state = 'drawing'; room.turnStart = Date.now(); room.turnMs = room.settings.drawTime * 1000;
  emitRoom(room);
  const base = { drawerId: room.drawerId, hint: hintString(room), ms: room.turnMs, round: room.round, rounds: room.settings.rounds };
  for (const p of room.players.values()) io.to(p.id).emit('turn:start', { ...base, word: p.id === room.drawerId ? room.word : undefined });
  // letter reveals
  const letters = room.word.split('').map((c, i) => (/[A-Za-z0-9]/.test(c) ? i : -1)).filter(i => i >= 0);
  const reveals = letters.length > 10 ? 3 : 2;
  const maxReveal = Math.max(0, Math.floor(letters.length / 2) - 1);
  for (let r = 1; r <= Math.min(reveals, maxReveal); r++) {
    room.timers['hint' + r] = setTimeout(() => {
      if (room.state !== 'drawing') return;
      const hidden = letters.filter(i => !room.hintMask[i]);
      if (!hidden.length) return;
      room.hintMask[hidden[rnd(hidden.length)]] = true;
      for (const p of room.players.values()) if (p.id !== room.drawerId && !p.guessed) io.to(p.id).emit('hint', hintString(room));
    }, room.turnMs * (r / (reveals + 1) + 0.12 * (r === 1 ? 0 : 0)));
  }
  room.timers.end = setTimeout(() => endTurn(room, 'time'), room.turnMs);
}

function endTurn(room, why) {
  if (room.state !== 'drawing' && room.state !== 'choosing') return;
  clearTimers(room);
  const wasChoosing = room.state === 'choosing';
  room.state = 'turnEnd';
  const word = room.word || (wasChoosing ? null : '');
  io.to(room.code).emit('turn:end', {
    word, why, gains: room.gains,
    players: [...room.players.values()].map(pub),
  });
  emitRoom(room);
  room.timers.next = setTimeout(() => nextTurn(room), TURN_END_MS);
}

function endGame(room) {
  clearTimers(room);
  room.state = 'gameEnd'; room.drawerId = null;
  const ranking = [...room.players.values()].map(pub).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('game:end', { ranking });
  emitRoom(room);
}

function backToLobby(room, msg) {
  clearTimers(room);
  room.state = 'lobby'; room.drawerId = null; room.round = 0; room.ops = [];
  for (const p of room.players.values()) p.guessed = false;
  if (msg) sys(room, msg);
  io.to(room.code).emit('lobby');
  emitRoom(room);
}

function handleGuess(room, p, text) {
  const k = key(text), n = norm(text);
  const w = room.wordObj;
  const hit = n && (w.keys.includes(k) || w.nkeys.includes(n));
  if (hit) {
    const frac = remainingMs(room) / room.turnMs;
    const pts = Math.round(500 * (0.25 + 0.75 * frac));
    p.guessed = true; p.score += pts; room.gains[p.id] = pts;
    const dr = room.players.get(room.drawerId);
    if (dr) { const g = Math.round(pts * 0.35); dr.score += g; room.gains[dr.id] = (room.gains[dr.id] || 0) + g; }
    sys(room, `${p.name} guessed the movie! 🎉`, 'good');
    io.to(p.id).emit('guessed', { word: room.word, pts });
    emitRoom(room);
    const guessers = [...room.players.values()].filter(x => x.id !== room.drawerId);
    if (guessers.every(x => x.guessed)) { room.timers.early = setTimeout(() => endTurn(room, 'all'), 800); }
    return;
  }
  // close guess: only the guesser hears about it
  const kw = w.keys.concat(w.nkeys);
  const close = kw.some(x => x.length >= 5 && (lev(k, x) <= (x.length >= 12 ? 2 : 1)));
  io.to(room.code).emit('chat', { kind: 'msg', from: p.name, fromId: p.id, text });
  if (close) io.to(p.id).emit('chat', { kind: 'close', text: `"${text}" is close! 🔥` });
}

// ---------- sockets ----------
function joinRoom(socket, room, name) {
  if (room.players.size >= MAX_PLAYERS) return socket.emit('err', 'Room is full.');
  name = clean(name, 16) || 'Player' + (1 + rnd(999));
  const taken = new Set([...room.players.values()].map(p => p.name.toLowerCase()));
  let nm = name, i = 2; while (taken.has(nm.toLowerCase())) nm = `${name} ${i++}`;
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = AVATARS.find(c => !used.has(c)) || AVATARS[rnd(AVATARS.length)];
  const p = { id: socket.id, name: nm, score: 0, guessed: false, color };
  room.players.set(socket.id, p);
  if (!room.hostId) room.hostId = socket.id;
  socket.join(room.code); socket.data.code = room.code;
  socket.emit('joined', { me: p.id, ...roomState(room), inGame: room.state !== 'lobby' });
  if (room.state === 'drawing') {
    socket.emit('turn:start', { drawerId: room.drawerId, hint: hintString(room), ms: remainingMs(room), round: room.round, rounds: room.settings.rounds, late: true });
    socket.emit('canvas:sync', room.ops);
  } else if (room.state === 'choosing') {
    socket.emit('turn:choosing', { drawerId: room.drawerId, round: room.round, rounds: room.settings.rounds, ms: 8000 });
  }
  sys(room, `${p.name} joined the room.`);
  emitRoom(room);
}

function leaveRoom(socket) {
  const code = socket.data.code; if (!code) return;
  const room = rooms.get(code); socket.data.code = null;
  if (!room) return;
  const p = room.players.get(socket.id); if (!p) return;
  room.players.delete(socket.id); socket.leave(code);
  sys(room, `${p.name} left.`);
  if (!room.players.size) { clearTimers(room); rooms.delete(code); return; }
  if (room.hostId === socket.id) { room.hostId = room.players.keys().next().value; sys(room, `${room.players.get(room.hostId).name} is now the host.`); }
  if (room.state !== 'lobby' && room.state !== 'gameEnd') {
    if (room.players.size < 2) return backToLobby(room, 'Not enough players. Back to lobby.');
    if (room.drawerId === socket.id) { sys(room, 'The artist left. Skipping turn.'); room.word = room.word || ''; endTurn(room, 'left'); return; }
    if (room.state === 'drawing') {
      const guessers = [...room.players.values()].filter(x => x.id !== room.drawerId);
      if (guessers.every(x => x.guessed)) endTurn(room, 'all');
    }
  }
  emitRoom(room);
}

const okColor = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

io.on('connection', socket => {
  const getRoom = () => rooms.get(socket.data.code);
  const drawerRoom = () => { const r = getRoom(); return r && r.state === 'drawing' && r.drawerId === socket.id ? r : null; };

  socket.on('room:create', ({ name, isPublic } = {}) => {
    if (socket.data.code) return;
    joinRoom(socket, newRoom(isPublic), name);
  });
  socket.on('room:join', ({ name, code } = {}) => {
    if (socket.data.code) return;
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('err', 'Room not found. Check the code.');
    joinRoom(socket, room, name);
  });
  socket.on('room:quick', ({ name } = {}) => {
    if (socket.data.code) return;
    const open = [...rooms.values()].filter(r => r.public && r.players.size < MAX_PLAYERS);
    open.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.players.size - a.players.size);
    joinRoom(socket, open[0] || newRoom(true), name);
  });
  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('settings', s => {
    const room = getRoom(); if (!room || room.hostId !== socket.id || room.state !== 'lobby' || !s) return;
    room.settings.rounds = num(s.rounds, 1, 10) | 0 || 3;
    room.settings.drawTime = num(s.drawTime, 30, 180) | 0 || 80;
    room.settings.pool = s.pool === 'all' ? 'all' : 'popular';
    emitRoom(room);
  });
  socket.on('game:start', () => {
    const room = getRoom(); if (!room || room.hostId !== socket.id || (room.state !== 'lobby' && room.state !== 'gameEnd')) return;
    if (room.players.size < 2) return socket.emit('err', 'Need at least 2 players to start.');
    startGame(room);
  });
  socket.on('game:lobby', () => {
    const room = getRoom(); if (!room || room.hostId !== socket.id || room.state !== 'gameEnd') return;
    backToLobby(room);
  });
  socket.on('word:pick', i => { const room = getRoom(); if (room && room.drawerId === socket.id) pickWord(room, i | 0); });

  socket.on('chat', text => {
    const room = getRoom(); if (!room) return;
    const p = room.players.get(socket.id); text = clean(text, 100); if (!p || !text) return;
    if (room.state === 'drawing' && socket.id !== room.drawerId && !p.guessed) return handleGuess(room, p, text);
    if (room.state === 'drawing' && (socket.id === room.drawerId || p.guessed)) {
      // private chat among drawer + people who already guessed
      const msg = { kind: 'msg', from: p.name, fromId: p.id, text, secret: true };
      for (const q of room.players.values()) if (q.id === room.drawerId || q.guessed) io.to(q.id).emit('chat', msg);
      return;
    }
    io.to(room.code).emit('chat', { kind: 'msg', from: p.name, fromId: p.id, text });
  });

  // drawing
  socket.on('stroke:begin', s => {
    const room = drawerRoom(); if (!room || !s || !okColor(s.c)) return;
    const op = { t: 's', id: s.id | 0, c: s.c, w: num(s.w, 1, 60), p: [num(s.x, 0, 800), num(s.y, 0, 600)] };
    if (room.ops.length > 3000) return;
    room.ops.push(op);
    socket.to(room.code).emit('stroke:begin', { id: op.id, c: op.c, w: op.w, x: op.p[0], y: op.p[1] });
  });
  socket.on('stroke:pts', s => {
    const room = drawerRoom(); if (!room || !s || !Array.isArray(s.p)) return;
    const op = [...room.ops].reverse().find(o => o.t === 's' && o.id === (s.id | 0)); if (!op) return;
    const pts = s.p.slice(0, 400).map(v => Math.round(num(v, 0, 800) * 10) / 10);
    if (op.p.length > 20000) return;
    op.p.push(...pts);
    socket.to(room.code).emit('stroke:pts', { id: op.id, p: pts });
  });
  socket.on('fill', s => {
    const room = drawerRoom(); if (!room || !s || !okColor(s.c)) return;
    const op = { t: 'f', c: s.c, x: num(s.x, 0, 800) | 0, y: num(s.y, 0, 600) | 0 };
    room.ops.push(op); socket.to(room.code).emit('fill', op);
  });
  socket.on('undo', () => { const room = drawerRoom(); if (!room || !room.ops.length) return; room.ops.pop(); io.to(room.code).emit('canvas:sync', room.ops); });
  socket.on('clear', () => { const room = drawerRoom(); if (!room) return; room.ops = []; io.to(room.code).emit('canvas:clear'); });

  socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TollyDraw running on http://localhost:${PORT}`));
