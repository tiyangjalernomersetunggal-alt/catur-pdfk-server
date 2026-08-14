(function(){
"use strict";

/* ============ STATE ============ */
let session = { token:null, name:null };
let settings = { music:false, sound:true, volume:50 };
let socket = null;
let play = { minutes:5, mode:'random', manualUsed:false, challengeTargetToken:null, searching:false };
let currentGame = null; // {gameId, color, chess, opponentName}
let onlineUsers = [];
let audioCtx = null, musicNodes = null;

/* ============ SETTINGS PERSISTENCE ============ */
try{
  const saved = JSON.parse(localStorage.getItem('pk_settings') || 'null');
  if(saved) settings = Object.assign(settings, saved);
}catch(e){}
function saveSettings(){
  try{ localStorage.setItem('pk_settings', JSON.stringify(settings)); }catch(e){}
}

/* ============ API HELPERS ============ */
async function api(path, body){
  const res = await fetch(path, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})
  });
  let data = {};
  try{ data = await res.json(); }catch(e){}
  if(!res.ok) throw new Error(data.error || 'Terjadi kesalahan.');
  return data;
}
async function apiGet(path){
  const res = await fetch(path);
  return res.json();
}

/* ============ UI HELPERS ============ */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
let toastTimeout=null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=>el.classList.add('hidden'), 3200);
}
function fmtTime(ms){
  if(ms<0) ms=0;
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const r = s%60;
  return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0');
}
function escapeHtml(str){
  const d = document.createElement('div'); d.textContent = str==null?'':String(str); return d.innerHTML;
}

/* ============ AUDIO ============ */
function ensureAudio(){
  if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
  if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); }
}
function beep(freq, dur){
  if(!settings.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq; osc.type='sine';
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime((settings.volume/100)*0.18, t0+0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0+dur+0.05);
}
function sfxMove(){ beep(520,0.12); }
function sfxNotify(){ beep(660,0.15); setTimeout(()=>beep(880,0.15),150); }
function sfxGameOver(win){ if(win){ beep(660,0.15); setTimeout(()=>beep(990,0.25),160);} else { beep(300,0.3); } }
function startMusic(){
  if(!audioCtx || musicNodes) return;
  const gain = audioCtx.createGain();
  gain.gain.value = (settings.volume/100)*0.045;
  gain.connect(audioCtx.destination);
  const o1 = audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value=196;
  const o2 = audioCtx.createOscillator(); o2.type='sine'; o2.frequency.value=246.94;
  o1.connect(gain); o2.connect(gain); o1.start(); o2.start();
  musicNodes = {gain,o1,o2};
}
function stopMusic(){ if(musicNodes){ try{musicNodes.o1.stop(); musicNodes.o2.stop();}catch(e){} musicNodes=null; } }
function applyAudioSettings(){
  if(musicNodes) musicNodes.gain.gain.value = (settings.volume/100)*0.045;
  if(settings.music) startMusic(); else stopMusic();
}

/* ============ SOCKET CONNECTION ============ */
function connectSocket(){
  socket = io();

  socket.on('connect', ()=>{
    document.getElementById('storage-warning').classList.add('hidden');
    if(session.token) socket.emit('auth', {token: session.token});
  });
  socket.on('connect_error', ()=>{
    document.getElementById('storage-warning').classList.remove('hidden');
  });
  socket.on('disconnect', ()=>{
    document.getElementById('storage-warning').classList.remove('hidden');
  });

  socket.on('auth:ok', ()=>{ /* server confirmed our session token */ });
  socket.on('error:message', (d)=> toast(d.text));

  socket.on('presence:update', (list)=>{
    onlineUsers = list;
    renderOnlineList();
    if(document.getElementById('screen-play-setup').classList.contains('active') && play.mode==='manual'){
      renderOpponentList();
    }
  });

  socket.on('leaderboard:update', (rows)=> renderLeaderboard(rows));

  socket.on('challenge:incoming', (c)=>{
    if(currentGame) return; // sudah main, abaikan tantangan baru
    document.getElementById('challenge-from').textContent = c.fromName;
    document.getElementById('challenge-time').textContent = c.minutes;
    document.getElementById('challenge-modal').classList.remove('hidden');
    ensureAudio(); sfxNotify();
  });

  socket.on('challenge:rejected', (d)=>{
    if(!play.searching || play.mode!=='manual') return;
    play.manualUsed = true;
    play.challengeTargetToken = null;
    const msg = d.reason==='timeout' ? 'Tidak ada respon, dialihkan ke pencarian acak.'
      : d.reason==='declined' ? 'Tantangan ditolak, dialihkan ke pencarian acak.'
      : 'Lawan sedang tidak bisa ditantang, dialihkan ke pencarian acak.';
    toast(msg);
    play.mode = 'random';
    document.getElementById('search-status-text').textContent = 'Mencari lawan secara acak...';
    socket.emit('queue:join', {minutes: play.minutes});
  });

  socket.on('game:start', (doc)=> enterGame(doc));
  socket.on('game:update', (doc)=> applyGameUpdate(doc));
  socket.on('game:over', (doc)=> handleGameOver(doc));
  socket.on('chat:message', (m)=>{
    if(!currentGame || m.gameId!==currentGame.gameId) return;
    appendChatMessage(m);
    if(m.from!==session.token) beep(740,0.08);
  });
}

/* ============ AUTH ============ */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-daftar').classList.toggle('hidden', tab.dataset.tab!=='daftar');
    document.getElementById('tab-masuk').classList.toggle('hidden', tab.dataset.tab!=='masuk');
  });
});

document.getElementById('btn-register').addEventListener('click', async ()=>{
  ensureAudio();
  const nameEl = document.getElementById('reg-name');
  const phoneEl = document.getElementById('reg-phone');
  const errEl = document.getElementById('reg-err');
  errEl.textContent='';
  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();
  if(!name || !phone){ errEl.textContent = 'Isi nama dan nomor WhatsApp dulu ya.'; return; }
  const btn = document.getElementById('btn-register');
  btn.disabled = true; btn.textContent='Memproses...';
  try{
    await api('/api/register', {name, phone});
    document.getElementById('registered-name').textContent = name;
    nameEl.value=''; phoneEl.value='';
    showScreen('screen-registered');
  }catch(e){
    errEl.textContent = e.message;
  }finally{
    btn.disabled=false; btn.textContent='Daftar';
  }
});

document.getElementById('btn-back-to-login').addEventListener('click', ()=>{
  showScreen('screen-auth');
  document.querySelector('.tab[data-tab="masuk"]').click();
});

document.getElementById('btn-login').addEventListener('click', async ()=>{
  ensureAudio();
  const el = document.getElementById('login-token');
  const errEl = document.getElementById('login-err');
  errEl.textContent='';
  const token = el.value.trim().toUpperCase();
  if(!token){ errEl.textContent='Masukkan token dulu.'; return; }
  try{
    const data = await api('/api/login', {token});
    session = {token: data.token, name: data.name};
    try{ localStorage.setItem('pk_token', data.token); }catch(e){}
    el.value='';
    enterDashboard();
  }catch(e){
    errEl.textContent = e.message;
  }
});

/* ============ DASHBOARD ============ */
function enterDashboard(){
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('chip-name').textContent = session.name;
  showScreen('screen-dashboard');
  refreshLeaderboard();
  if(socket && socket.connected) socket.emit('auth', {token: session.token});
}

async function refreshLeaderboard(){
  try{
    const rows = await apiGet('/api/leaderboard');
    renderLeaderboard(rows);
  }catch(e){}
}

function renderOnlineList(){
  const el = document.getElementById('online-list');
  const others = onlineUsers.filter(p=>p.token!==session.token);
  if(others.length===0){ el.innerHTML = '<div class="empty-note">Belum ada rekan lain yang online.</div>'; return; }
  el.innerHTML = others.map(p=>{
    const busy = p.status==='in-game';
    return '<div class="tag"><span class="pin"></span><span>'+escapeHtml(p.name)+'</span><span class="dot" style="background:'+(busy?'var(--alert)':'var(--good)')+'"></span></div>';
  }).join('');
}

function renderLeaderboard(scores){
  const body = document.getElementById('leaderboard-body');
  if(!scores || scores.length===0){ body.innerHTML = '<tr><td colspan="4" class="empty-note">Belum ada data.</td></tr>'; return; }
  body.innerHTML = scores.slice(0,12).map((s,i)=>{
    return '<tr><td class="'+(i===0?'rank-1':'')+'">'+(i+1)+'</td><td class="name">'+escapeHtml(s.name)+'</td><td>'+(s.wins||0)+'</td><td>'+(s.points||0)+'</td></tr>';
  }).join('');
  const mine = scores.find(s=>s.name===session.name);
  document.getElementById('chip-points').textContent = (mine ? (mine.points||0) : 0) + ' poin';
}

document.getElementById('btn-menu-play').addEventListener('click', ()=>{
  ensureAudio();
  play = { minutes:5, mode:'random', manualUsed:false, challengeTargetToken:null, searching:false };
  document.querySelectorAll('#time-options .opt-btn').forEach(b=>b.classList.toggle('selected', b.dataset.min==='5'));
  document.querySelectorAll('#opp-mode-options .opt-btn').forEach(b=>b.classList.toggle('selected', b.dataset.mode==='random'));
  document.getElementById('manual-picker').style.display='none';
  document.getElementById('search-status').style.display='none';
  document.getElementById('btn-start-search').classList.remove('hidden');
  document.getElementById('btn-cancel-search').classList.add('hidden');
  showScreen('screen-play-setup');
});
document.getElementById('btn-menu-settings').addEventListener('click', ()=>{ renderSettings(); showScreen('screen-settings'); });
document.getElementById('btn-menu-exit').addEventListener('click', doExit);
document.getElementById('back-from-setup').addEventListener('click', ()=>{ cancelSearch(); showScreen('screen-dashboard'); });
document.getElementById('back-from-settings').addEventListener('click', ()=>{ showScreen('screen-dashboard'); });

function doExit(){
  try{ localStorage.removeItem('pk_token'); }catch(e){}
  if(socket) socket.disconnect();
  session = {token:null, name:null};
  currentGame = null;
  document.getElementById('topbar').classList.add('hidden');
  showScreen('screen-auth');
  toast('Sampai jumpa lagi. Token kamu tetap berlaku untuk masuk berikutnya.');
  setTimeout(connectSocket, 300);
}

/* ============ PLAY SETUP ============ */
document.querySelectorAll('#time-options .opt-btn').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#time-options .opt-btn').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    play.minutes = parseInt(b.dataset.min,10);
  });
});
document.querySelectorAll('#opp-mode-options .opt-btn').forEach(b=>{
  b.addEventListener('click', ()=>{
    if(b.dataset.mode==='manual' && play.manualUsed){
      toast('Pilih manual cuma berlaku sekali per sesi cari lawan. Lanjut ke acak server.');
      return;
    }
    document.querySelectorAll('#opp-mode-options .opt-btn').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    play.mode = b.dataset.mode;
    document.getElementById('manual-picker').style.display = play.mode==='manual' ? 'block' : 'none';
    if(play.mode==='manual') renderOpponentList();
  });
});

function renderOpponentList(){
  const others = onlineUsers.filter(p=>p.token!==session.token && p.status!=='in-game');
  const el = document.getElementById('opponent-list');
  if(others.length===0){ el.innerHTML = '<div class="empty-note">Tidak ada rekan yang bisa ditantang sekarang.</div>'; return; }
  el.innerHTML = others.map(p=>'<div class="opp-row"><span>'+escapeHtml(p.name)+'</span><button data-token="'+p.token+'" data-name="'+escapeHtml(p.name)+'">Tantang</button></div>').join('');
  el.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      play.challengeTargetToken = btn.dataset.token;
      play.challengeTargetName = btn.dataset.name;
      startSearch();
    });
  });
}

document.getElementById('btn-start-search').addEventListener('click', ()=>{
  if(play.mode==='manual'){ toast('Pilih salah satu rekan di daftar untuk ditantang.'); return; }
  startSearch();
});
document.getElementById('btn-cancel-search').addEventListener('click', cancelSearch);

function startSearch(){
  ensureAudio();
  play.searching = true;
  document.getElementById('btn-start-search').classList.add('hidden');
  document.getElementById('btn-cancel-search').classList.remove('hidden');
  document.getElementById('search-status').style.display='block';

  if(play.mode==='manual' && play.challengeTargetToken){
    document.getElementById('search-status-text').textContent = 'Menantang ' + play.challengeTargetName + '...';
    socket.emit('challenge:send', {targetToken: play.challengeTargetToken, minutes: play.minutes});
  } else {
    document.getElementById('search-status-text').textContent = 'Mencari lawan secara acak...';
    socket.emit('queue:join', {minutes: play.minutes});
  }
}

function cancelSearch(){
  play.searching = false;
  document.getElementById('search-status').style.display='none';
  document.getElementById('btn-start-search').classList.remove('hidden');
  document.getElementById('btn-cancel-search').classList.add('hidden');
  if(socket) socket.emit('queue:leave');
}

/* ============ CHALLENGE RECEIVE ============ */
document.getElementById('btn-challenge-accept').addEventListener('click', ()=>{
  ensureAudio();
  document.getElementById('challenge-modal').classList.add('hidden');
  socket.emit('challenge:respond', {accept:true});
});
document.getElementById('btn-challenge-reject').addEventListener('click', ()=>{
  document.getElementById('challenge-modal').classList.add('hidden');
  socket.emit('challenge:respond', {accept:false});
});

/* ============ GAME ============ */
function pieceGlyph(type, color){
  const map = { p:['♙','♟'], n:['♘','♞'], b:['♗','♝'], r:['♖','♜'], q:['♕','♛'], k:['♔','♚'] };
  return color==='w' ? map[type][0] : map[type][1];
}

function enterGame(doc){
  play.searching = false;
  const chessInst = new Chess();
  if(doc.fen && doc.fen!=='start') chessInst.load(doc.fen);
  currentGame = {
    gameId: doc.gameId, color: doc.color, chess: chessInst, selected:null,
    opponentName: doc.opponentName, whiteMs: doc.whiteMs, blackMs: doc.blackMs,
    turn: doc.turn, turnStartedAt: doc.turnStartedAt, status:'active'
  };
  document.getElementById('game-opponent-name').textContent = 'vs ' + currentGame.opponentName;
  document.getElementById('clock-top-label').textContent = currentGame.opponentName;
  document.getElementById('clock-bottom-label').textContent = session.name + ' (kamu)';
  document.getElementById('game-status-text').textContent = '';
  document.getElementById('chat-messages').innerHTML = '';
  renderBoard();
  updateClocksDisplay();
  showScreen('screen-game');
  clearInterval(window._clockTick);
  window._clockTick = setInterval(updateClocksDisplay, 1000);
  if(!doc.resumed) toast('Permainan dimulai! Kamu jalan sebagai ' + (doc.color==='w'?'Putih':'Hitam') + '.');
}

function applyGameUpdate(doc){
  if(!currentGame) return;
  if(currentGame.chess.fen()!==doc.fen){
    currentGame.chess.load(doc.fen);
    sfxMove();
  }
  currentGame.turn = doc.turn;
  currentGame.whiteMs = doc.whiteMs;
  currentGame.blackMs = doc.blackMs;
  currentGame.turnStartedAt = doc.turnStartedAt;
  currentGame.selected = null;
  renderBoard();
  updateClocksDisplay();
}

function updateClocksDisplay(){
  if(!currentGame) return;
  const myColor = currentGame.color;
  const oppColor = myColor==='w'?'b':'w';
  let whiteLeft = currentGame.whiteMs, blackLeft = currentGame.blackMs;
  if(currentGame.status==='active'){
    const elapsed = Date.now() - currentGame.turnStartedAt;
    if(currentGame.turn==='w') whiteLeft -= elapsed; else blackLeft -= elapsed;
  }
  const myLeft = myColor==='w'?whiteLeft:blackLeft;
  const oppLeft = myColor==='w'?blackLeft:whiteLeft;
  document.getElementById('clock-top-time').textContent = fmtTime(oppLeft);
  document.getElementById('clock-bottom-time').textContent = fmtTime(myLeft);
  document.getElementById('clock-top').classList.toggle('active', currentGame.status==='active' && currentGame.turn===oppColor);
  document.getElementById('clock-bottom').classList.toggle('active', currentGame.status==='active' && currentGame.turn===myColor);
  document.getElementById('clock-top').classList.toggle('low', oppLeft<30000);
  document.getElementById('clock-bottom').classList.toggle('low', myLeft<30000);
  document.getElementById('game-status-text').textContent = currentGame.status==='active' ? (currentGame.turn===myColor ? 'Giliranmu' : 'Giliran lawan') : '';
}

function renderBoard(){
  const boardEl = document.getElementById('board');
  boardEl.innerHTML='';
  const myColor = currentGame.color;
  const board = currentGame.chess.board();
  const flip = myColor==='b';
  let legalTargets = [];
  if(currentGame.selected){
    legalTargets = currentGame.chess.moves({square:currentGame.selected, verbose:true}).map(m=>m.to);
  }
  for(let displayRow=0; displayRow<8; displayRow++){
    for(let displayCol=0; displayCol<8; displayCol++){
      const row = flip ? 7-displayRow : displayRow;
      const col = flip ? 7-displayCol : displayCol;
      const file = 'abcdefgh'[col];
      const rank = 8-row;
      const sqName = file+rank;
      const piece = board[row][col];
      const div = document.createElement('div');
      const light = (row+col)%2===0;
      div.className = 'sq ' + (light?'light':'dark');
      if(currentGame.selected===sqName) div.classList.add('selected');
      if(legalTargets.includes(sqName)){ div.classList.add('movable'); if(piece) div.classList.add('occupied'); }
      if(piece){
        const span = document.createElement('span');
        span.className = piece.color==='w' ? 'piece-w' : 'piece-b';
        span.textContent = pieceGlyph(piece.type, piece.color);
        div.appendChild(span);
      }
      div.addEventListener('click', ()=>onSquareClick(sqName));
      boardEl.appendChild(div);
    }
  }
}

function onSquareClick(sqName){
  if(!currentGame || currentGame.status!=='active') return;
  if(currentGame.turn!==currentGame.color){ toast('Bukan giliranmu.'); return; }
  const chess = currentGame.chess;
  const piece = chess.get(sqName);
  if(currentGame.selected){
    if(currentGame.selected===sqName){ currentGame.selected=null; renderBoard(); return; }
    const moves = chess.moves({square:currentGame.selected, verbose:true});
    const found = moves.find(m=>m.to===sqName);
    if(found){
      const moveOpts = {from:currentGame.selected, to:sqName};
      if(found.flags.indexOf('p')!==-1) moveOpts.promotion='q';
      const result = chess.move(moveOpts);
      currentGame.selected=null;
      if(result){
        sfxMove();
        renderBoard();
        socket.emit('game:move', {gameId: currentGame.gameId, from: moveOpts.from, to: moveOpts.to, promotion: moveOpts.promotion});
        return;
      }
    } else if(piece && piece.color===currentGame.color){
      currentGame.selected = sqName; renderBoard(); return;
    } else {
      currentGame.selected=null
