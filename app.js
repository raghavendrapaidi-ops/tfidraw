(() => {
const $ = id => document.getElementById(id);
const socket = io();
let me = null, room = null;
let drawerId = null, isDrawer = false, drawing = false;
let endAt = 0, timerIv = null, myWord = null;

// ---------- screens / helpers ----------
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const initial = n => (n || '?').trim().charAt(0).toUpperCase();

// ---------- home ----------
const m = location.pathname.match(/^\/r\/([A-Za-z]{4})/);
if (m) $('code').value = m[1].toUpperCase();
$('name').value = safeGet('td_name');
const getName = () => { const n = $('name').value.trim(); safeSet('td_name', n); return n; };
$('btnCreate').onclick = () => socket.emit('room:create', { name: getName(), isPublic: false });
$('btnQuick').onclick = () => socket.emit('room:quick', { name: getName() });
$('btnJoin').onclick = () => {
  const code = $('code').value.trim();
  if (code.length !== 4) { $('homeErr').textContent = 'Enter the 4-letter room code.'; return; }
  socket.emit('room:join', { name: getName(), code });
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
socket.on('err', t => { $('homeErr').textContent = t; toast(t); });

// ---------- room state ----------
socket.on('joined', d => {
  me = d.me; room = d; $('homeErr').textContent = '';
  history.replaceState(null, '', '/r/' + d.code);
  clearChat(); resetCanvas();
  route();
});
socket.on('room', d => { room = d; renderPlayers(); if (room.state === 'lobby' && !$('lobby').classList.contains('active')) { show('lobby'); } renderLobby(); });
socket.on('lobby', () => { hideOverlay(); stopTimer(); show('lobby'); renderLobby(); });
function route() {
  if (room.state === 'lobby') { show('lobby'); renderLobby(); }
  else { show('game'); renderPlayers(); }
}

// ---------- lobby ----------
function renderLobby() {
  if (!room) return;
  const host = room.hostId === me;
  $('lobbyCode').textContent = room.code;
  $('inviteLink').value = location.origin + '/r/' + room.code;
  $('plCount').textContent = `(${room.players.length}/12)`;
  $('lobbyPlayers').innerHTML = room.players.map(p =>
    `<li><span class="av" style="background:${p.color}">${esc(initial(p.name))}</span><span class="pname">${esc(p.name)}${p.id === me ? ' (you)' : ''}</span>${p.id === room.hostId ? '<span class="badge">HOST</span>' : ''}</li>`).join('');
  $('setRounds').value = room.settings.rounds; $('setTime').value = room.settings.drawTime; $('setPool').value = room.settings.pool;
  ['setRounds', 'setTime', 'setPool'].forEach(i => $(i).disabled = !host);
  $('btnStart').classList.toggle('hidden', !host);
  $('btnStart').disabled = room.players.length < 2;
  $('lobbyMsg').textContent = host ? (room.players.length < 2 ? 'Waiting for at least one more player…' : '') : 'Waiting for the host to start…';
}
function sendSettings() { socket.emit('settings', { rounds: +$('setRounds').value, drawTime: +$('setTime').value, pool: $('setPool').value }); }
['setRounds', 'setTime', 'setPool'].forEach(i => $(i).onchange = sendSettings);
$('btnStart').onclick = () => socket.emit('game:start');
$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('inviteLink').value); } catch { $('inviteLink').select(); document.execCommand('copy'); }
  toast('Invite link copied!');
};
$('btnLeaveLobby').onclick = () => { socket.emit('room:leave'); room = null; history.replaceState(null, '', '/'); show('home'); };

// ---------- players list ----------
function renderPlayers() {
  if (!room) return;
  const ps = [...room.players].sort((a, b) => b.score - a.score);
  $('gamePlayers').innerHTML = ps.map(p => {
    const cls = p.id === room.drawerId ? 'drawing' : (p.guessed ? 'guessed' : '');
    const ico = p.id === room.drawerId ? '✏️' : (p.guessed ? '✅' : '');
    return `<li class="${cls}"><span class="av" style="background:${p.color}">${esc(initial(p.name))}</span><span class="pinfo"><span class="pname">${esc(p.name)}${p.id === me ? ' (you)' : ''}</span><span class="sc">${p.score} pts</span></span><span class="ico">${ico}</span></li>`;
  }).join('');
}

// ---------- chat ----------
function clearChat() { $('chatLog').innerHTML = ''; }
socket.on('chat', c => {
  const log = $('chatLog'), d = document.createElement('div');
  if (c.kind === 'msg') { d.innerHTML = `<b class="from">${esc(c.from)}:</b> ${esc(c.text)}`; if (c.secret) d.className = 'secret'; }
  else { d.className = c.kind; d.textContent = c.text; }
  log.appendChild(d); log.scrollTop = log.scrollHeight;
  while (log.children.length > 200) log.removeChild(log.firstChild);
});
$('chatForm').onsubmit = e => { e.preventDefault(); const v = $('chatInput').value.trim(); if (v) socket.emit('chat', v); $('chatInput').value = ''; };

// ---------- timer ----------
function startTimer(ms) { endAt = performance.now() + ms; clearInterval(timerIv); tick(); timerIv = setInterval(tick, 250); }
function stopTimer() { clearInterval(timerIv); $('timer').textContent = '0'; $('timer').classList.remove('low'); }
function tick() { const s = Math.max(0, Math.ceil((endAt - performance.now()) / 1000)); $('timer').textContent = s; $('timer').classList.toggle('low', s <= 10 && s > 0); }

// ---------- overlay ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); $('overlay').innerHTML = ''; }
const setHint = (t, mine) => {
  t = t || '';
  const counts = t.split(' ').map(w => w.replace(/[^A-Za-z0-9_]/g, '').length).filter(n => n > 0);
  const meta = counts.length ? `<div class="meta">${counts.join(' · ')} letters</div>` : '';
  if (mine) { $('hint').innerHTML = `<div class="drawword">${esc(t)}</div>${meta}`; return; }
  const words = t.split(' ').map(w => `<span class="word">${w.split('').map(c => c === '_' ? '<span class="ch blank"></span>' : `<span class="ch">${esc(c)}</span>`).join('')}</span>`).join('');
  $('hint').innerHTML = `<div class="chars">${words}</div>${meta}`;
};

socket.on('turn:choosing', d => {
  drawerId = d.drawerId; isDrawer = d.drawerId === me; myWord = null; room.drawerId = d.drawerId; room.state = 'choosing';
  show('game'); resetCanvas(); setTools(false);
  $('roundInfo').textContent = `Round ${d.round}/${d.rounds}`;
  $('hintLabel').textContent = isDrawer ? 'PICK A MOVIE' : 'GET READY'; $('hint').textContent = '';
  startTimer(d.ms);
  if (!isDrawer) { const p = room.players.find(x => x.id === d.drawerId); showOverlay(`<h2>${esc(p ? p.name : 'Someone')} is choosing a movie…</h2><div>✏️ Get ready to guess!</div>`); }
  renderPlayers();
});
socket.on('turn:choices', list => {
  showOverlay(`<h2>Pick a movie to draw</h2><div class="choices">${list.map((w, i) =>
    `<button class="choice ${w.tier}" data-i="${i}">${esc(w.word)}<small>${w.tier.toUpperCase()}</small></button>`).join('')}</div><div class="muted" style="color:#ddd">Draw it without writing letters!</div>`);
  $('overlay').querySelectorAll('.choice').forEach(b => b.onclick = () => { socket.emit('word:pick', +b.dataset.i); });
});
socket.on('turn:start', d => {
  drawerId = d.drawerId; isDrawer = d.drawerId === me; room.drawerId = d.drawerId; room.state = 'drawing';
  show('game'); hideOverlay();
  $('roundInfo').textContent = `Round ${d.round}/${d.rounds}`;
  if (isDrawer) { myWord = d.word; $('hintLabel').textContent = 'DRAW THIS'; setHint(d.word || '', true); }
  else { $('hintLabel').textContent = 'GUESS THE MOVIE'; setHint(d.hint, false); }
  setTools(isDrawer);
  $('chatInput').placeholder = isDrawer ? 'Chat with guessers who got it…' : 'Type your guess here…';
  startTimer(d.ms); renderPlayers();
});
socket.on('hint', h => { if (!isDrawer) setHint(h, false); });
socket.on('guessed', d => { setHint(d.word, true); $('hintLabel').textContent = `YOU GOT IT! +${d.pts}`; $('chatInput').placeholder = 'Chat with other guessers…'; });
socket.on('turn:end', d => {
  setTools(false); stopTimer(); room.state = 'turnEnd';
  const reasons = { time: "Time's up!", all: 'Everyone guessed it!', left: 'The artist left.' };
  const list = [...d.players].sort((a, b) => b.score - a.score);
  showOverlay(`<h2>${reasons[d.why] || ''}</h2>${d.word ? `<div>The movie was</div><div class="big">${esc(d.word)}</div>` : ''}
    <ul class="board">${list.map(p => `<li><span class="n">${esc(p.name)}</span><span class="g">${d.gains[p.id] ? '+' + d.gains[p.id] : ''}</span><span>${p.score}</span></li>`).join('')}</ul>`);
  $('hintLabel').textContent = 'THE MOVIE WAS'; $('hint').textContent = d.word || '';
  renderPlayers();
});
socket.on('game:end', d => {
  setTools(false); stopTimer(); hideOverlay();
  const host = room && room.hostId === me;
  const medals = ['🥇', '🥈', '🥉'];
  showOverlay(`<h2>🏆 Final Scores</h2><ul class="board">${d.ranking.map((p, i) => `<li><span>${medals[i] || (i + 1) + '.'}</span><span class="n">${esc(p.name)}</span><span>${p.score}</span></li>`).join('')}</ul>
    ${host ? '<button class="btn primary" id="btnAgain">Play Again</button><button class="btn" id="btnToLobby">Back to Lobby</button>' : '<div>Waiting for the host…</div>'}
    <button class="linkbtn" id="btnExit" style="color:#ddd">Leave room</button>`);
  const a = $('btnAgain'); if (a) a.onclick = () => socket.emit('game:start');
  const l = $('btnToLobby'); if (l) l.onclick = () => socket.emit('game:lobby');
  $('btnExit').onclick = () => { socket.emit('room:leave'); room = null; history.replaceState(null, '', '/'); show('home'); };
  $('hintLabel').textContent = 'GAME OVER'; $('hint').textContent = '';
});

// ---------- canvas ----------
const cv = $('cv'), ctx = cv.getContext('2d', { willReadFrequently: true });
const COLORS = ['#000000', '#7f7f7f', '#ffffff', '#c1c1c1', '#ef130b', '#ff7100', '#ffe400', '#00cc00', '#00b2ff', '#231fd3', '#a300ba',
  '#4c4c4c', '#880000', '#a0522d', '#ffc89a', '#005f00', '#00a8a8', '#0050cd', '#ff6cbf'];
const SIZES = [3, 7, 14, 28];
let ops = [], color = '#000000', size = 7, tool = 'pen', sid = 0, cur = null, pending = [], flushT = null;

function resetCanvas() { ops = []; clearCanvas(); }
function clearCanvas() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 600); }
function styleFor(op) { ctx.strokeStyle = op.c; ctx.fillStyle = op.c; ctx.lineWidth = op.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function drawSeg(op, from) {
  styleFor(op); const p = op.p;
  if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(p[Math.max(0, from - 2)], p[Math.max(0, from - 2) + 1]);
  for (let i = Math.max(0, from); i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}
function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
function floodFill(x0, y0, col) {
  const W = 800, H = 600; x0 |= 0; y0 |= 0; if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  const img = ctx.getImageData(0, 0, W, H), d = img.data, [fr, fg, fb] = hex(col);
  const i0 = (y0 * W + x0) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  if (tr === fr && tg === fg && tb === fb) return;
  const match = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= 60;
  const stack = [[x0, y0]];
  while (stack.length) {
    let [x, y] = stack.pop(); let i = (y * W + x) * 4;
    while (x >= 0 && match(i)) { x--; i -= 4; }
    x++; i += 4; let up = false, dn = false;
    while (x < W && match(i)) {
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      if (y > 0) { const u = i - W * 4, ok = match(u); if (ok && !up) { stack.push([x, y - 1]); up = true; } else if (!ok) up = false; }
      if (y < H - 1) { const v = i + W * 4, ok = match(v); if (ok && !dn) { stack.push([x, y + 1]); dn = true; } else if (!ok) dn = false; }
      x++; i += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function redraw() { clearCanvas(); for (const op of ops) op.t === 's' ? drawSeg(op, 0) : floodFill(op.x, op.y, op.c); }

socket.on('stroke:begin', s => { const op = { t: 's', id: s.id, c: s.c, w: s.w, p: [s.x, s.y] }; ops.push(op); drawSeg(op, 0); });
socket.on('stroke:pts', s => {
  const op = [...ops].reverse().find(o => o.t === 's' && o.id === s.id); if (!op) return;
  const from = op.p.length; op.p.push(...s.p); drawSeg(op, from);
});
socket.on('fill', f => { ops.push({ t: 'f', c: f.c, x: f.x, y: f.y }); floodFill(f.x, f.y, f.c); });
socket.on('canvas:sync', list => { ops = list; redraw(); });
socket.on('canvas:clear', () => resetCanvas());

function pos(e) { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(800, (e.clientX - r.left) * 800 / r.width)), Math.max(0, Math.min(600, (e.clientY - r.top) * 600 / r.height))]; }
const canDraw = () => isDrawer && room && room.state === 'drawing';
function flush() {
  flushT = null; if (!cur || !pending.length) return;
  socket.emit('stroke:pts', { id: cur.id, p: pending.map(v => Math.round(v * 10) / 10) }); pending = [];
}
cv.addEventListener('pointerdown', e => {
  if (!canDraw()) return; e.preventDefault(); cv.setPointerCapture(e.pointerId);
  const [x, y] = pos(e);
  if (tool === 'fill') { ops.push({ t: 'f', c: color, x, y }); floodFill(x, y, color); socket.emit('fill', { c: color, x, y }); return; }
  const c = tool === 'eraser' ? '#ffffff' : color;
  cur = { t: 's', id: ++sid, c, w: tool === 'eraser' ? size * 2 : size, p: [x, y] };
  ops.push(cur); drawSeg(cur, 0); drawing = true;
  socket.emit('stroke:begin', { id: cur.id, c: cur.c, w: cur.w, x, y });
});
cv.addEventListener('pointermove', e => {
  if (!drawing || !cur) return; e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const from = cur.p.length;
  for (const ev of (evs.length ? evs : [e])) { const [x, y] = pos(ev); cur.p.push(x, y); pending.push(x, y); }
  drawSeg(cur, from);
  if (!flushT) flushT = setTimeout(flush, 40);
});
const endStroke = () => { if (!drawing) return; drawing = false; flush(); cur = null; };
cv.addEventListener('pointerup', endStroke); cv.addEventListener('pointercancel', endStroke);

// ---------- tools ----------
function setTools(on) { $('tools').classList.toggle('hidden', !on); cv.classList.toggle('nodraw', !on); }
$('palette').innerHTML = COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
$('sizes').innerHTML = SIZES.map(s => `<button class="sz" data-s="${s}"><i style="width:${Math.min(s, 24)}px;height:${Math.min(s, 24)}px"></i></button>`).join('');
function syncTools() {
  document.querySelectorAll('.sw').forEach(b => b.classList.toggle('sel', b.dataset.c === color));
  document.querySelectorAll('.sz').forEach(b => b.classList.toggle('sel', +b.dataset.s === size));
  ['Pen', 'Fill', 'Eraser'].forEach(t => $('t' + t).classList.toggle('sel', tool === t.toLowerCase()));
}
$('palette').onclick = e => { const b = e.target.closest('.sw'); if (!b) return; color = b.dataset.c; if (tool === 'eraser') tool = 'pen'; syncTools(); };
$('sizes').onclick = e => { const b = e.target.closest('.sz'); if (!b) return; size = +b.dataset.s; syncTools(); };
$('tPen').onclick = () => { tool = 'pen'; syncTools(); };
$('tFill').onclick = () => { tool = 'fill'; syncTools(); };
$('tEraser').onclick = () => { tool = 'eraser'; syncTools(); };
$('tUndo').onclick = () => canDraw() && socket.emit('undo');
$('tClear').onclick = () => canDraw() && socket.emit('clear');
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && canDraw() && document.activeElement !== $('chatInput')) { e.preventDefault(); socket.emit('undo'); } });
syncTools(); clearCanvas();

socket.on('disconnect', () => { toast('Disconnected from server'); room = null; show('home'); history.replaceState(null, '', '/'); });
})();
