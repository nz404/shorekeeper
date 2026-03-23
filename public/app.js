// ════════════════════════════════════
// STATE
// ════════════════════════════════════
let token       = localStorage.getItem('sk_token');
let userRole    = localStorage.getItem('sk_role') || 'guest';
let adminName   = localStorage.getItem('sk_admin_name') || 'Irvan';
let ws          = null;
let model       = null;
let msgCounter  = 0;
let autoTTS     = localStorage.getItem('sk_tts') === 'true';
let ttsSpeaking = false;
let ttsUtter    = null;
let isRecording = false;
let recognition = null;
let isLight     = localStorage.getItem('sk_theme') === 'light';
let modelSettings = JSON.parse(localStorage.getItem('sk_model') || '{"scale":92,"offsetX":0,"offsetY":0}');
const DEFAULT_MODEL = { scale: 92, offsetX: 0, offsetY: 0 };
const synth = window.speechSynthesis;

// ════════════════════════════════════
// AUTH
// ════════════════════════════════════
async function checkAuth() {
  if (!token) return showLogin();
  try {
    const r = await fetch('/api/verify', { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.ok) {
      userRole = d.role || 'guest';
      localStorage.setItem('sk_role', userRole);
      showApp();
    } else {
      showLogin();
    }
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  applyTheme();
  loadSavedBg();
  loadSavedSettings();
  // Tutup WS lama dulu sebelum buat baru
  if (ws) { try { ws.close(); } catch {} ws = null; }
  // Reset chat history saat login baru
  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = `<div class="m a"><div class="sn">Shorekeeper</div>Sistem telah aktif, Kak ${adminName}. Shorekeeper kembali bertugas mengawasi mercusuar.</div>`;
  initWS();
  initLive2D();
  initVoice();
  initQA();
  setTimeout(loadMood, 2000);
  document.getElementById('tts-toggle').textContent = autoTTS ? '🔊' : '🔇';
  if (autoTTS) document.getElementById('tts-toggle').classList.add('on');
}

function applyRoleRestrictions() {
  const isGuest = userRole === 'guest';

  // Sembunyikan SEMUA quick action untuk guest
  document.querySelectorAll('.qa-btn').forEach(btn => {
    btn.style.display = isGuest ? 'none' : '';
  });

  // Sembunyikan qa-panel header juga kalau guest (tidak ada tombol apapun)
  const qaPanel = document.getElementById('qa-panel');
  if (qaPanel) qaPanel.style.display = isGuest ? 'none' : '';

  // Sembunyikan side panel dan docker untuk guest
  const sidePanelBtn = document.querySelector('.tool-btn[onclick="toggleSidePanel()"]');
  if (sidePanelBtn) sidePanelBtn.style.display = isGuest ? 'none' : '';

  const dockerPanel = document.getElementById('docker-panel');
  if (dockerPanel) dockerPanel.classList.remove('open');

  // Tampilkan badge guest - limit dari server
  if (isGuest) {
    const sub = document.querySelector('#ph .sub');
    if (sub) sub.textContent = 'Demo Mode · memuat...';
    // Ambil sisa pesan dari server
    fetch('/api/guest-info', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (sub) sub.textContent = `Demo Mode · ${d.remaining}/${d.limit} pesan tersisa`;
      }).catch(() => {
        if (sub) sub.textContent = 'Demo Mode';
      });
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const pw = document.getElementById('pw-input').value;
  if (!pw) return;
  const un = document.getElementById('un-input').value.trim();
  if (!un) { document.getElementById('login-err').textContent = 'Username tidak boleh kosong.'; return; }
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: un, password: pw })
  });
  const d = await r.json();
  if (d.ok) {
    token    = d.token;
    userRole = d.role || 'guest';
    localStorage.setItem('sk_token', token);
    localStorage.setItem('sk_role',  userRole);
    document.getElementById('login-err').textContent = '';
    showApp();
  } else {
    document.getElementById('login-err').textContent = d.message || 'Password salah.';
  }
});
document.getElementById('pw-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});
document.getElementById('un-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pw-input').focus();
});

// ════════════════════════════════════
// WEBSOCKET
// ════════════════════════════════════
const msgs = document.getElementById('msgs');
const typ  = document.getElementById('typ');
const dot  = document.getElementById('dot');
const inp  = document.getElementById('inp');

function initWS() {
  // Selalu ambil token terbaru dari localStorage
  const currentToken = localStorage.getItem('sk_token') || token;
  token = currentToken;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: currentToken }));
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'auth') {
      if (msg.ok) {
        dot.classList.add('on');
        // Update role dan nama dari server response
        userRole  = msg.role || userRole;
        if (msg.adminName) {
          adminName = msg.adminName;
          localStorage.setItem('sk_admin_name', adminName);
        }
        localStorage.setItem('sk_role', userRole);
        applyRoleRestrictions();
        if (userRole === 'guest') {
          fetch('/api/guest-info', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then(d => {
              const sub = document.querySelector('#ph .sub');
              if (sub) sub.textContent = `Demo Mode · ${d.remaining}/${d.limit} pesan tersisa`;
            }).catch(() => {});
        }
        // Apply mood dari auth response
        if (msg.mood) applyMood(msg.mood, msg.expression, msg.moodEmoji);
      } else {
        localStorage.removeItem('sk_token');
        showLogin();
      }
    }

    if (msg.type === 'guest_info') {
      const sub = document.querySelector('#ph .sub');
      if (sub) sub.textContent = `Demo Mode · ${msg.remaining}/${msg.limit} pesan tersisa`;
    }
    if (msg.type === 'typing') { typ.style.display = msg.status ? 'block' : 'none'; msgs.scrollTop = msgs.scrollHeight; }
    if (msg.type === 'chat' && msg.role === 'assistant') {
      addMsg('a', 'Shorekeeper', msg.content);
      if (msg.expression) triggerExp(msg.expression);
      else autoExpression(msg.content);
      if (model) { try { model.motion('Talk'); } catch {} }
    }
    if (msg.type === 'error') addMsg('a', 'System', msg.message);

    if (msg.type === 'mood_update') {
      applyMood(msg.mood, msg.expression, msg.emoji);
    }
  };
  ws.onclose = () => {
    dot.classList.remove('on');
    // Hanya reconnect kalau masih login
    if (localStorage.getItem('sk_token')) setTimeout(initWS, 3000);
  };
}

function addMsg(role, sender, text) {
  typ.style.display = 'none';
  const id = `msg-${++msgCounter}`;
  const d  = document.createElement('div');
  d.className = `m ${role}`;
  d.id = id;
  const ttsBtn = role === 'a'
    ? `<div class="msg-actions"><button class="tts-btn" onclick="playTTS('${id}',this)" data-text="${text.replace(/"/g,"'").slice(0,300)}">🔊 Dengar</button></div>`
    : '';
  d.innerHTML = `<div class="sn">${sender}</div>${fmt(text)}${ttsBtn}`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  if (role === 'a' && autoTTS) setTimeout(() => { const btn = d.querySelector('.tts-btn'); if (btn) playTTS(id, btn); }, 300);
}

function fmt(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// Autocomplete hint untuk command
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('inp');
  if (!inp) return;
  inp.addEventListener('input', function() {
    const val = this.value;
    if (val === '/') {
      // Tampilkan mini hint
      showCommandHint();
    } else if (!val.startsWith('/')) {
      hideCommandHint();
    }
  });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideCommandHint();
  });
});

const COMMANDS = ['/help', '/ping', '/proxmox', '/ssh', '/docker', '/laporan'];
let hintShown = false;

function showCommandHint() {
  if (hintShown) return;
  hintShown = true;
  const area = document.getElementById('inp-area');
  if (!area || document.getElementById('cmd-hint')) return;
  const hint = document.createElement('div');
  hint.id = 'cmd-hint';
  hint.style.cssText = 'position:absolute;bottom:100%;left:0;right:0;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px 8px 0 0;padding:6px 12px;font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;z-index:10;';
  hint.innerHTML = COMMANDS.map(c =>
    `<span style="cursor:pointer;color:var(--accent);padding:2px 6px;background:var(--bg-btn);border-radius:4px" onclick="document.getElementById('inp').value='${c} ';document.getElementById('inp').focus();hideCommandHint()">${c}</span>`
  ).join('');
  area.style.position = 'relative';
  area.prepend(hint);
}

function hideCommandHint() {
  hintShown = false;
  document.getElementById('cmd-hint')?.remove();
}

function send() {
  const text = inp.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  const sender = userRole === 'admin' ? `Kak ${adminName}` : 'Guest';
  addMsg('u', sender, text);
  ws.send(JSON.stringify({ type: 'chat', content: text, token }));
  inp.value = '';
  inp.style.height = 'auto';
}

document.getElementById('sbtn').addEventListener('click', send);
inp.addEventListener('touchstart', () => inp.focus(), { passive: true });
inp.addEventListener('click', () => inp.focus());
inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight,110)+'px'; });

// ════════════════════════════════════
// QUICK ACTIONS TOGGLE
// ════════════════════════════════════
let qaVisible = localStorage.getItem('sk_qa') !== 'false';

function initQA() {
  if (!qaVisible) {
    document.getElementById('qa-grid').classList.add('hidden');
    document.getElementById('qa-toggle-icon').classList.add('collapsed');
  }
}

function toggleQA() {
  qaVisible = !qaVisible;
  localStorage.setItem('sk_qa', qaVisible);
  document.getElementById('qa-grid').classList.toggle('hidden', !qaVisible);
  document.getElementById('qa-toggle-icon').classList.toggle('collapsed', !qaVisible);
}

// ════════════════════════════════════
// QUICK ACTIONS
// ════════════════════════════════════
const QA_LABELS = {
  status:'📊 Cek Status Server', proxmox:'🏝️ Lihat Proxmox',
  monitor:'🖥️ Laporan Monitor', ssh:'🌐 Daftar Alias SSH',
  laporan:'📋 Laporan Infrastruktur', troubleshoot:'🔍 Troubleshoot',
};

function quickAction(key, el) {
  if (!ws || ws.readyState !== 1) return;
  if (userRole === 'guest') return; // Sudah disembunyikan, tapi double check
  document.querySelectorAll('.qa-btn').forEach(b => b.classList.remove('active'));
  if (el) { el.classList.add('active'); setTimeout(() => el.classList.remove('active'), 2000); }
  addMsg('u', `Kak ${adminName}`, QA_LABELS[key]);
  if (key === 'troubleshoot') {
    ws.send(JSON.stringify({ type: 'chat', content: 'Server apa saja yang bisa saya troubleshoot?', token }));
  } else {
    ws.send(JSON.stringify({ type: 'action', action: key, token }));
  }
}

// ════════════════════════════════════
// DOCKER PANEL
// ════════════════════════════════════
async function toggleDockerPanel() {
  const panel = document.getElementById('docker-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) loadDockerServers();
}

async function loadDockerServers() {
  const r = await fetch('/api/docker/servers', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!r.ok) return;
  const data = await r.json();
  const sel  = document.getElementById('docker-server-select');
  sel.innerHTML = '<option value="">— Pilih Server —</option>';
  (data.aliases || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.alias;
    opt.textContent = `${a.alias} (${a.host})`;
    sel.appendChild(opt);
  });
}

async function loadDockerContainers(alias) {
  const body = document.getElementById('docker-body');
  body.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px">Memuat container...</div>';

  const r = await fetch('/api/docker/containers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ alias })
  });
  const data = await r.json();

  if (!data.ok) {
    body.innerHTML = `<div style="color:#e05555;font-size:13px;padding:10px">${data.message}</div>`;
    return;
  }

  if (!data.containers.length) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px">Tidak ada container.</div>';
    return;
  }

  body.innerHTML = data.containers.map(c => `
    <div class="dock-item">
      <div class="dk-name">
        <span class="dk-status ${c.running ? 'on' : 'off'}"></span>${c.name}
      </div>
      <div class="dk-image">${c.image}</div>
      <div class="dk-btns">
        ${c.running
          ? `<button class="dk-btn danger" onclick="dockerAction('${alias}','${c.id}','stop',this)">🛑 Stop</button>
             <button class="dk-btn" onclick="dockerAction('${alias}','${c.id}','restart',this)">🔄 Restart</button>`
          : `<button class="dk-btn" onclick="dockerAction('${alias}','${c.id}','start',this)">▶️ Start</button>`
        }
        <button class="dk-btn" onclick="showDockerLogs('${alias}','${c.id}')">📋 Logs</button>
      </div>
    </div>
  `).join('');
}

async function dockerAction(alias, id, action, btn) {
  btn.disabled = true;
  btn.textContent = '⏳';
  const r = await fetch('/api/docker/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ alias, containerId: id, action })
  });
  const data = await r.json();
  // Reload list setelah action
  const sel = document.getElementById('docker-server-select');
  if (sel?.value) setTimeout(() => loadDockerContainers(sel.value), 1500);
}

async function showDockerLogs(alias, id) {
  const body = document.getElementById('docker-body');
  body.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px">Memuat logs...</div>';
  const r = await fetch('/api/docker/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ alias, containerId: id })
  });
  const data = await r.json();
  const logs = data.logs || 'Tidak ada logs.';
  body.innerHTML = `
    <button class="dk-btn" onclick="loadDockerContainers(document.getElementById('docker-server-select').value)" style="margin-bottom:8px">⬅️ Kembali</button>
    <pre style="font-size:11px;color:var(--text-sec);white-space:pre-wrap;word-break:break-all">${logs.slice(-2000)}</pre>
  `;
}

// ════════════════════════════════════
// BACKGROUND
// ════════════════════════════════════
function togglePanel(id) {
  ['model-panel','bg-panel'].forEach(p => { if(p!==id) document.getElementById(p).classList.remove('open'); });
  document.getElementById(id).classList.toggle('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.float-panel') && !e.target.closest('.tool-btn') && !e.target.closest('#docker-panel') && e.target.id !== 'docker-toggle') {
    document.querySelectorAll('.float-panel').forEach(p => p.classList.remove('open'));
  }
});

function setBg(name, el) {
  document.body.className = `bg-${name}`;
  document.body.style.backgroundImage = '';
  document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  localStorage.setItem('sk_bg', JSON.stringify({ type: 'preset', value: name }));
}

function setBgColor(color) {
  document.body.className = '';
  document.body.style.background = color;
  document.body.style.backgroundImage = '';
  document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
  localStorage.setItem('sk_bg', JSON.stringify({ type: 'color', value: color }));
}

function setBgImage() {
  const url = document.getElementById('bg-url').value.trim();
  if (!url) return;
  document.body.className = 'bg-custom';
  document.body.style.backgroundImage = `url(${url})`;
  document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
  localStorage.setItem('sk_bg', JSON.stringify({ type: 'image', value: url }));
}

function loadSavedBg() {
  const saved = localStorage.getItem('sk_bg');
  if (!saved) return;
  try {
    const { type, value } = JSON.parse(saved);
    if (type === 'preset')      { document.body.className = `bg-${value}`; document.querySelector(`.bg-preset[data-bg="${value}"]`)?.classList.add('active'); }
    else if (type === 'color')  { document.body.style.background = value; document.getElementById('bg-color').value = value; }
    else if (type === 'image')  { document.body.className = 'bg-custom'; document.body.style.backgroundImage = `url(${value})`; document.getElementById('bg-url').value = value; }
  } catch {}
}

// ════════════════════════════════════
// THEME
// ════════════════════════════════════
function applyTheme() {
  document.body.classList.toggle('light', isLight);
  document.getElementById('theme-btn').textContent = isLight ? '☀️' : '🌙';
  document.getElementById('login-screen').style.background = isLight ? '#f0f5fa' : '#06090f';
}

function toggleTheme() {
  isLight = !isLight;
  localStorage.setItem('sk_theme', isLight ? 'light' : 'dark');
  applyTheme();
}

// ════════════════════════════════════
// MODEL SETTINGS
// ════════════════════════════════════
function isMobile() { return window.innerWidth <= 768; }
function getCanvasSize() {
  return isMobile()
    ? { W: window.innerWidth, H: window.innerHeight * 0.35 }
    : { W: window.innerWidth - 400, H: window.innerHeight };
}

function updateModel(key, val) {
  if (!model) return;
  if (key === 'scale') modelSettings.scale = parseFloat(val);
  else if (key === 'x') modelSettings.offsetX = parseFloat(val);
  else if (key === 'y') modelSettings.offsetY = parseFloat(val);
  applyModelTransform();
  localStorage.setItem('sk_model', JSON.stringify(modelSettings));
}

function applyModelTransform() {
  // Reposisi bubble setelah transform diterapkan
  requestAnimationFrame(() => {
    const skMsg = document.getElementById('sk-speech');
    if (skMsg && parseFloat(skMsg.style.opacity) > 0) positionBubble();
  });
  if (!model || !model.internalModel) return;
  const { W, H } = getCanvasSize();
  const origH = model.internalModel.originalHeight;
  const origW = model.internalModel.originalWidth;
  if (!origH) return;
  const scale = H / origH * (modelSettings.scale / 100);
  model.scale.set(scale);
  model.x = W / 2 - (origW * scale) / 2 + modelSettings.offsetX;
  model.y = H - (origH * scale) * 0.97 + modelSettings.offsetY;
}

function resetModel() {
  modelSettings = { ...DEFAULT_MODEL };
  localStorage.setItem('sk_model', JSON.stringify(modelSettings));
  document.getElementById('s-scale').value = DEFAULT_MODEL.scale;
  document.getElementById('s-x').value     = DEFAULT_MODEL.offsetX;
  document.getElementById('s-y').value     = DEFAULT_MODEL.offsetY;
  document.getElementById('v-scale').textContent = DEFAULT_MODEL.scale + '%';
  document.getElementById('v-x').textContent     = DEFAULT_MODEL.offsetX;
  document.getElementById('v-y').textContent     = DEFAULT_MODEL.offsetY;
  applyModelTransform();
}

function loadSavedSettings() {
  document.getElementById('s-scale').value = modelSettings.scale;
  document.getElementById('s-x').value     = modelSettings.offsetX;
  document.getElementById('s-y').value     = modelSettings.offsetY;
  document.getElementById('v-scale').textContent = modelSettings.scale + '%';
  document.getElementById('v-x').textContent     = modelSettings.offsetX;
  document.getElementById('v-y').textContent     = modelSettings.offsetY;
}

// ════════════════════════════════════
// LIVE2D
// ════════════════════════════════════
async function initLive2D() {
  const canvas = document.getElementById('cv');
  const { W, H } = getCanvasSize();
  const app = new PIXI.Application({
    view:               canvas,
    transparent:        true,
    width:              W,
    height:             H,
    resolution:         window.devicePixelRatio || 1,
    autoDensity:        true,
    clearBeforeRender:  true,
    preserveDrawingBuffer: false,
  });

  window.addEventListener('resize', () => {
    const { W: nW, H: nH } = getCanvasSize();
    app.renderer.resize(nW, nH);
    applyModelTransform();
    // Re-posisikan bubble kalau sedang tampil
    const skMsg = document.getElementById('sk-speech');
    if (skMsg && parseFloat(skMsg.style.opacity) > 0) positionBubble();
  });

  // ── Mouse tracking ──
  document.addEventListener('mousemove', (e) => {
    if (!model || !model.internalModel) return;
    const canvas = app.view;
    const rect   = canvas.getBoundingClientRect();
    // Normalkan ke -1 ~ 1 relatif ke tengah canvas
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const nx = (e.clientX - cx) / (rect.width  / 2);
    const ny = (e.clientY - cy) / (rect.height / 2);
    try {
      model.internalModel.focusController.focus(nx * 0.6, -ny * 0.4);
    } catch {}
  });

  try {
    model = await PIXI.live2d.Live2DModel.from('/model/IceGirl.model3.json', { autoInteract: false });
    app.stage.addChild(model);
    loadSavedSettings();
    applyModelTransform();
    model.motion('Idle');
    setInterval(() => { try { model.motion('Idle'); } catch {} }, 8000);
    model.interactive = true;
    model.on('pointerdown', () => { try { model.motion('Idle'); } catch {} });

    // ── Click reaction — pasang di document bukan canvas ──
    document.addEventListener('click', (e) => {
      if (!model) return;
      const canvas = app.view;
      const rect   = canvas.getBoundingClientRect();
      // Hanya proses kalau klik di area canvas Live2D
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      if (e.clientY < rect.top  || e.clientY > rect.bottom) return;
      // Jangan proses klik pada UI element (tombol, panel, dll)
      if (e.target.closest('button, .float-panel, #docker-panel, #side-panel, #chat-panel, #qa-panel, input, select, textarea')) return;

      const x     = (e.clientX - rect.left) / rect.width  * canvas.width;
      const y     = (e.clientY - rect.top)  / rect.height * canvas.height;
      const headY = canvas.height * 0.25;
      const bodyY = canvas.height * 0.60;
      const cx    = canvas.width  / 2;
      const dist  = Math.sqrt((x - cx) ** 2 + (y - headY) ** 2);

      if (dist < canvas.width * 0.18)  handleHeadClick();
      else if (y > headY && y < bodyY) handleBodyClick();
      else                             handleAreaClick();
    });

  } catch (err) {
    console.warn('Live2D gagal dimuat:', err.message);
  }
}

function triggerExp(name) { if (!model) return; try { model.expression(name); } catch {} }

function autoExpression(text) {
  const t = text.toLowerCase();
  if (/gagal|error|anomali|masalah|rusak|down|offline/.test(t))         triggerExp('surprised');
  else if (/maaf|aduh|khawatir/.test(t))                                 triggerExp('blush');
  else if (/tidak yakin|mungkin|belum pasti/.test(t))                    triggerExp('confused');
  else if (/berhasil|aman|stabil|aktif|normal|lancar/.test(t))           triggerExp('heart');
  else if (/waspada|peringatan|alert|threshold/.test(t))                 triggerExp('angry');
  else if (/laporan|status|data|cpu|ram/.test(t))                        triggerExp('star');
  setTimeout(() => { try { if(model) model.expression(''); } catch {} }, 4000);
}

// ════════════════════════════════════
// TTS
// ════════════════════════════════════
function toggleTTS() {
  autoTTS = !autoTTS;
  localStorage.setItem('sk_tts', autoTTS);
  const btn = document.getElementById('tts-toggle');
  btn.textContent = autoTTS ? '🔊' : '🔇';
  btn.classList.toggle('on', autoTTS);
  if (!autoTTS) { synth.cancel(); ttsSpeaking = false; }
}

function getBestVoice() {
  const voices = synth.getVoices();
  const preferred = ['Microsoft Hazel', 'Microsoft Susan', 'Hazel', 'Susan'];
  for (const name of preferred) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }
  return voices.find(v => !/male|man|george|david|mark/i.test(v.name)) || voices[0];
}

function playTTS(msgId, btn) {
  if (ttsSpeaking) {
    synth.cancel(); ttsSpeaking = false;
    document.querySelectorAll('.tts-btn').forEach(b => { b.classList.remove('playing'); b.textContent = '🔊 Dengar'; });
    if (btn.dataset.stopped === msgId) { btn.dataset.stopped = ''; return; }
  }
  btn.dataset.stopped = msgId;
  btn.classList.add('playing');
  btn.textContent = '⏹ Stop';
  ttsSpeaking = true;

  const cleanText = (btn.dataset.text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/[🛡️✨🌊📊🏝️🖥️🔍🌐📋⚠️❌✅🔴🟢├└│]/gu, '').trim();

  ttsUtter = new SpeechSynthesisUtterance(cleanText);
  ttsUtter.rate = 0.95; ttsUtter.pitch = 1.1; ttsUtter.volume = 1.0;

  const setVoice = () => {
    const voice = getBestVoice();
    if (voice) ttsUtter.voice = voice;
    if (model) { try { model.motion('Talk'); } catch {} }
    ttsUtter.onend = () => { ttsSpeaking = false; btn.classList.remove('playing'); btn.textContent = '🔊 Dengar'; if(model){try{model.motion('Idle');}catch{}} };
    ttsUtter.onerror = () => { ttsSpeaking = false; btn.classList.remove('playing'); btn.textContent = '🔊 Dengar'; };
    synth.speak(ttsUtter);
  };

  synth.getVoices().length > 0 ? setVoice() : (synth.onvoiceschanged = setVoice);
}

// ════════════════════════════════════
// VOICE INPUT
// ════════════════════════════════════
function initVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) { document.getElementById('mic-btn').style.display = 'none'; return; }
  recognition = new SpeechRec();
  recognition.continuous = false; recognition.interimResults = true; recognition.lang = 'id-ID';
  recognition.onresult = e => { inp.value = Array.from(e.results).map(r => r[0].transcript).join(''); inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight,110)+'px'; };
  recognition.onend = () => { isRecording = false; document.getElementById('mic-btn').classList.remove('recording'); document.getElementById('mic-btn').textContent = '🎤'; if (inp.value.trim()) send(); };
  recognition.onerror = () => { isRecording = false; document.getElementById('mic-btn').classList.remove('recording'); document.getElementById('mic-btn').textContent = '🎤'; };
}

function toggleVoice() {
  if (!recognition) return;
  if (isRecording) { recognition.stop(); return; }
  if (ttsSpeaking) { synth.cancel(); ttsSpeaking = false; }
  isRecording = true;
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-btn').textContent = '⏹';
  recognition.lang = 'id-ID';
  recognition.start();
}

// ════════════════════════════════════
// INIT
// ════════════════════════════════════
// ════════════════════════════════════
// LIVE2D CLICK REACTIONS
// ════════════════════════════════════

const clickResponses = {
    head: [
        { expr: 'blush',     motion: 'Idle',  msg: 'H-hmph! Jangan sembarangan menyentuh kepala SK!' },
        { expr: 'blush',     motion: 'DaiJi', msg: 'B-bukan berarti SK senang ya...' },
        { expr: 'surprised', motion: 'Idle',  msg: '...!' },
        { expr: 'blush',     motion: 'DaiJi', msg: 'J-jangan salah paham, ini bukan undangan.' },
    ],
    body: [
        { expr: 'heart',     motion: 'DaiJi', msg: 'Shorekeeper siap bertugas, Kak.' },
        { expr: 'star',      motion: 'Idle',  msg: 'Ada yang perlu SK bantu?' },
        { expr: 'blush',     motion: 'DaiJi', msg: '...SK sedang sibuk memantau mercusuar.' },
    ],
    area: [
        { expr: 'surprised', motion: 'Idle',  msg: '!' },
        { expr: 'confused',  motion: 'Idle',  msg: 'Hmm?' },
        { expr: 'heart',     motion: 'Idle',  msg: '...' },
    ],
};

let lastClickTime = 0;
const CLICK_COOLDOWN = 2000;

function handleHeadClick() {
    const now = Date.now();
    if (now - lastClickTime < CLICK_COOLDOWN) return;
    lastClickTime = now;

    const r = clickResponses.head[Math.floor(Math.random() * clickResponses.head.length)];
    triggerExp(r.expr);
    if (model) {
        try { model.motion(r.motion); } catch {}
    }

    // Tampilkan pesan bubble singkat
    showClickBubble(r.msg);
}

function handleBodyClick() {
    const now = Date.now();
    if (now - lastClickTime < CLICK_COOLDOWN) return;
    lastClickTime = now;

    const r = clickResponses.body[Math.floor(Math.random() * clickResponses.body.length)];
    triggerExp(r.expr);
    if (model) {
        try { model.motion(r.motion); } catch {}
    }
    showClickBubble(r.msg);
}

function handleAreaClick() {
    const now = Date.now();
    if (now - lastClickTime < CLICK_COOLDOWN) return;
    lastClickTime = now;

    const r = clickResponses.area[Math.floor(Math.random() * clickResponses.area.length)];
    triggerExp(r.expr);
    showClickBubble(r.msg);
}

let bubbleTimeout = null;

// Hitung posisi kepala model di layar berdasarkan canvas + model settings
function getHeadScreenPos() {
  const canvas = document.getElementById('cv');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();

  const s       = modelSettings || DEFAULT_MODEL;
  const scale   = (s.scale || 92) / 100;
  const offsetX = parseFloat(s.offsetX) || 0;
  const offsetY = parseFloat(s.offsetY) || 0;

  // Live2D IceGirl: model berdiri dari bawah canvas.
  // Kepala ada di ~18% dari atas canvas pada scale 100%.
  // Scale < 100 → model lebih kecil → kepala lebih turun proporsional.
  // offsetY positif = model naik → kepala ikut naik.

  const mob = isMobile();

  // Titik acuan: pusat bawah canvas (pivot model)
  const pivotX = rect.left + rect.width  / 2 + offsetX;
  const pivotY = rect.top  + rect.height       + offsetY;

  // Tinggi model visual = canvas.height * scale
  // Kepala ada di ~85% dari atas model (dari bawah pivot)
  const modelH = rect.height * scale;
  const headFromBottom = modelH * 0.85; // kepala 85% dari bawah = 15% dari atas model

  const headX = pivotX;
  const headY = pivotY - headFromBottom;

  return { x: headX, y: headY };
}

function positionBubble() {
  const skMsg = document.getElementById('sk-speech');
  if (!skMsg) return;

  const pos = getHeadScreenPos();
  if (!pos) return;

  const bubbleW   = skMsg.offsetWidth  || 280;
  const bubbleH   = skMsg.offsetHeight || 60;
  const margin    = 16;
  const isMob     = isMobile();

  if (isMob) {
    // Mobile: tepat di atas kepala, tengah secara X
    let left = pos.x - bubbleW / 2;
    let top  = pos.y - bubbleH - margin;
    left = Math.max(8, Math.min(window.innerWidth - bubbleW - 8, left));
    top  = Math.max(8, top);
    skMsg.style.left      = left + 'px';
    skMsg.style.top       = top  + 'px';
    skMsg.style.transform = 'none';
  } else {
    // Desktop: tampil di kanan-atas kepala
    // Model ada di kiri layar (canvas width = innerWidth - 400)
    // Ruang aman: x = 0 s/d (innerWidth - 400 - margin)
    const panelLeft = window.innerWidth - 400;
    let left = pos.x + margin * 3;          // geser kanan dari kepala
    let top  = pos.y - bubbleH - margin;    // di atas kepala

    // Kalau tidak muat di kanan, taruh di kiri kepala
    if (left + bubbleW > panelLeft - margin) {
      left = pos.x - bubbleW - margin * 3;
    }
    left = Math.max(margin, left);
    top  = Math.max(margin, top);
    skMsg.style.left      = left + 'px';
    skMsg.style.top       = top  + 'px';
    skMsg.style.transform = 'none';
  }
}

function showClickBubble(text) {
  const skMsg = document.getElementById('sk-speech');
  if (!skMsg) return;
  skMsg.textContent = text;
  // Posisikan dulu (sementara invisible agar bisa ukur offsetWidth)
  skMsg.style.visibility = 'hidden';
  skMsg.style.opacity    = '1';
  // Tunggu 1 frame agar browser render ukuran teks dulu
  requestAnimationFrame(() => {
    positionBubble();
    skMsg.style.visibility = 'visible';
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    bubbleTimeout = setTimeout(() => { skMsg.style.opacity = '0'; }, 3500);
  });
}

// ════════════════════════════════════
// MOOD SYSTEM
// ════════════════════════════════════
let currentMood = 'tenang';

function applyMood(mood, expression, emoji) {
  if (!mood || mood === currentMood) return;
  currentMood = mood;

  // Update Live2D expression
  if (expression) triggerExp(expression);

  // Update mood indicator di header
  const ico = document.querySelector('#ph .ico');
  if (ico) ico.textContent = emoji || '🛡️';

  // Update tooltip
  const btn = document.querySelector('#ph .ico');
  if (btn) btn.title = `Mood SK: ${mood}`;

  // Log
  console.log(`🎭 Mood SK: ${mood}`);
}

async function loadMood() {
  if (userRole !== 'admin') return;
  try {
    const r = await fetch('/api/mood', { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.ok) applyMood(d.mood, d.expression, d.emoji);
  } catch {}
}

// ════════════════════════════════════
// UPTIME HISTORY
// ════════════════════════════════════
function toggleUptimePanel() {
  if (userRole !== 'admin') return;
  const panel = document.getElementById('uptime-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  // Tutup docker panel juga kalau sedang terbuka
  document.getElementById('docker-panel')?.classList.remove('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    const activeDays = parseInt(document.querySelector('.uptime-day-btn.active')?.dataset.days || '7');
    loadUptimeData(activeDays);
  }
}

// Agar showUptimePanel lama tetap bekerja kalau ada yang memanggil
function showUptimePanel(days) { toggleUptimePanel(); }

async function loadUptimeData(days = 7) {
  const body = document.getElementById('uptime-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center">Memuat data uptime...</div>';
  try {
    const r = await fetch(`/api/uptime?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!d.ok) { body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:16px">Gagal memuat data.</div>'; return; }
    if (!d.summary?.length) { body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center">Belum ada data uptime.</div>'; return; }

    body.innerHTML = d.summary.map(s => {
      const pct   = parseFloat(s.uptimePct) || 0;
      const color = pct >= 99 ? '#3aaa70' : pct >= 95 ? '#d4aa20' : '#e05555';
      const bar   = Math.min(100, Math.round(pct));
      const lastDownStr = s.lastDown ? new Date(s.lastDown).toLocaleString('id-ID') : null;
      return `
        <div class="uptime-item" onclick="loadUptimeDetail('${s.alias}', ${days})">
          <div class="uptime-item-header">
            <span class="dk-status ${s.isOnline ? 'on' : 'off'}" style="margin-right:6px"></span>
            <span class="uptime-alias">${s.alias}</span>
            <span class="uptime-pct" style="color:${color}">${pct.toFixed(1)}%</span>
          </div>
          <div class="uptime-bar-wrap">
            <div class="uptime-bar" style="width:${bar}%;background:${color}"></div>
          </div>
          ${lastDownStr
            ? `<div class="uptime-lastdown">Terakhir down: ${lastDownStr}</div>`
            : '<div class="uptime-lastdown" style="color:#3aaa70">Tidak pernah down 🟢</div>'}
        </div>`;
    }).join('');
  } catch {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:16px">Error memuat data.</div>';
  }
}

async function loadUptimeDetail(alias, days = 7) {
  const body = document.getElementById('uptime-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center">Memuat detail...</div>';
  try {
    const r = await fetch(`/api/uptime/${encodeURIComponent(alias)}?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!d.ok) return;
    const pct   = parseFloat(d.uptimePct) || 0;
    const color = pct >= 99 ? '#3aaa70' : pct >= 95 ? '#d4aa20' : '#e05555';
    const bar   = Math.min(100, Math.round(pct));
    const evHtml = d.events?.length
      ? d.events.map(e => `
          <div class="uptime-event ${e.status}">
            <span>${e.status === 'down' ? '🔴' : '🟢'} ${e.status.toUpperCase()}</span>
            <span style="color:var(--text-muted)">${new Date(e.occurred_at).toLocaleString('id-ID')}</span>
          </div>`).join('')
      : '<div style="color:var(--text-muted);font-size:12px;padding:8px">Tidak ada event down.</div>';

    body.innerHTML = `
      <button onclick="loadUptimeData(${days})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;padding:0;margin-bottom:12px">← Semua Server</button>
      <div class="uptime-detail-header">
        <span style="font-weight:500">${alias}</span>
        <span style="color:${color};font-weight:600">${pct.toFixed(2)}%</span>
      </div>
      <div class="uptime-bar-wrap" style="margin:8px 0 16px">
        <div class="uptime-bar" style="width:${bar}%;background:${color}"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Riwayat Event (${days} hari)</div>
      <div class="uptime-events">${evHtml}</div>`;
  } catch {}
}

function setUptimeDays(days, btn) {
  document.querySelectorAll('.uptime-day-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadUptimeData(days);
}

// ════════════════════════════════════
// LOGOUT
// ════════════════════════════════════
async function logout() {
  if (!confirm('Yakin mau logout?')) return;
  try {
    await fetch('/api/logout', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
  localStorage.removeItem('sk_token');
  localStorage.removeItem('sk_role');
  token    = null;
  userRole = 'guest';
  if (ws) { ws.close(); ws = null; }
  showLogin();
  // Reset form
  document.getElementById('un-input').value = '';
  document.getElementById('pw-input').value = '';
  document.getElementById('login-err').textContent = '';
}

applyTheme();
checkAuth();

// ════════════════════════════════════
// SIDE PANEL (REMINDER & NOTES)
// ════════════════════════════════════
let currentTab = 'reminder';
let currentNoteTag = '';

function toggleSidePanel() {
  const panel = document.getElementById('side-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    loadReminders();
    loadNotes();
    loadReportSchedule();
    // Set default datetime ke sekarang + 1 jam
    const dt = new Date(Date.now() + 3600000);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    document.getElementById('rem-datetime').value = local;
  }
}

function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.sp-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-reminder').style.display = tab === 'reminder' ? 'block' : 'none';
  document.getElementById('tab-notes').style.display    = tab === 'notes'    ? 'block' : 'none';
}

// ── REMINDER WEB ──
async function loadReminders() {
  const r = await fetch('/api/reminders', { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const list = document.getElementById('reminder-list');
  if (!data.reminders?.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:10px">Belum ada reminder aktif.</div>';
    return;
  }
  list.innerHTML = data.reminders.map(rem => {
    const rep = rem.repeat_type !== 'none' ? ` · ↻ ${rem.repeat_type === 'daily' ? 'Harian' : 'Mingguan'}` : '';
    return `
    <div class="sp-item">
      <div class="sp-item-title">📝 ${rem.message}</div>
      <div class="sp-item-sub">🕐 ${new Date(rem.remind_at).toLocaleString('id-ID')}${rep}</div>
      <div class="sp-item-btns">
        <button class="sp-edit-btn" onclick="showEditReminder(${rem.id}, this)">✏️ Edit</button>
        <button class="sp-del-btn"  onclick="deleteReminderWeb(${rem.id})">🗑️ Hapus</button>
      </div>
    </div>`;
  }).join('');
}

async function addReminderWeb() {
  const message  = document.getElementById('rem-title').value.trim();
  const datetime = document.getElementById('rem-datetime').value;
  const repeat   = document.getElementById('rem-repeat').value;
  if (!message || !datetime) return alert('Isi pesan dan waktu dulu!');

  const r = await fetch('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, remindAt: new Date(datetime).toISOString(), repeatType: repeat })
  });
  const data = await r.json();
  if (data.ok) {
    document.getElementById('rem-title').value = '';
    loadReminders();
  }
}

async function deleteReminderWeb(id) {
  await fetch(`/api/reminders/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  loadReminders();
}

// ── NOTES WEB ──
async function loadNotes(tag = currentNoteTag, keyword = '') {
  const params = new URLSearchParams();
  if (tag)     params.set('tag', tag);
  if (keyword) params.set('q', keyword);

  const r = await fetch(`/api/notes?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const list = document.getElementById('notes-list');

  if (!data.notes?.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:10px">Belum ada catatan.</div>';
    return;
  }

  const tagEmoji = { general:'📝', server:'🖥️', config:'⚙️', network:'🌐', personal:'👤' };
  list.innerHTML = data.notes.map(n => `
    <div class="sp-item">
      <div class="sp-item-title">${tagEmoji[n.tag]||'📝'} ${n.title}</div>
      <div class="sp-item-sub">${new Date(n.created_at).toLocaleDateString('id-ID')}</div>
      <div class="sp-item-content">${n.content.slice(0, 100)}${n.content.length > 100 ? '...' : ''}</div>
      <div class="sp-item-btns">
        <button class="sp-edit-btn" onclick="showEditNote(${n.id}, this)">✏️ Edit</button>
        <button class="sp-del-btn"  onclick="deleteNoteWeb(${n.id})">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
}

async function addNoteWeb() {
  const title   = document.getElementById('note-title').value.trim();
  const content = document.getElementById('note-content').value.trim();
  const tag     = document.getElementById('note-tag').value;
  if (!title || !content) return alert('Isi judul dan isi catatan!');

  const r = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, content, tag })
  });
  const data = await r.json();
  if (data.ok) {
    document.getElementById('note-title').value   = '';
    document.getElementById('note-content').value = '';
    loadNotes();
  }
}

async function deleteNoteWeb(id) {
  await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  loadNotes(currentNoteTag);
}

function filterNotes(tag, btn) {
  currentNoteTag = tag;
  document.querySelectorAll('.sp-tag').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadNotes(tag);
}

function searchNotesWeb() {
  const kw = document.getElementById('note-search').value.trim();
  loadNotes('', kw);
}

document.getElementById('note-search')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchNotesWeb();
});

// ════════════════════════════════════
// REPORT SCHEDULE (Web)
// ════════════════════════════════════
async function loadReportSchedule() {
  const r = await fetch('/api/report-schedule', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return;
  const data = await r.json();
  if (data.pagi)  document.getElementById('sched-pagi').value  = data.pagi;
  if (data.malam) document.getElementById('sched-malam').value = data.malam;
}

async function saveReportSchedule() {
  const pagi  = document.getElementById('sched-pagi').value;
  const malam = document.getElementById('sched-malam').value;

  const r = await fetch('/api/report-schedule', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ pagi, malam })
  });
  const data = await r.json();
  if (data.ok) {
    const btn = document.getElementById('sched-save-btn');
    btn.textContent = '✅ Tersimpan!';
    setTimeout(() => { btn.textContent = 'Simpan Jadwal'; }, 2000);
  }
}

// ════════════════════════════════════
// EDIT REMINDER
// ════════════════════════════════════

function showEditReminder(id, btn) {
  const item = btn.closest('.sp-item');
  if (!item || item.querySelector('.sp-edit-form')) return;
  const curMsg = item.querySelector('.sp-item-title')?.textContent.replace('📝 ', '').trim() || '';
  item.querySelector('.sp-item-btns').insertAdjacentHTML('beforebegin', `
    <div class="sp-edit-form">
      <input type="text" class="sp-edit-input" id="edit-rem-msg-${id}" value="${curMsg.replace(/"/g,'&quot;')}" placeholder="Pesan...">
      <input type="datetime-local" class="sp-edit-input" id="edit-rem-dt-${id}">
      <select class="sp-edit-input" id="edit-rem-rep-${id}">
        <option value="none">Sekali saja</option>
        <option value="daily">Setiap hari</option>
        <option value="weekly">Setiap minggu</option>
      </select>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="sp-submit" style="flex:1;padding:6px" onclick="saveEditReminder(${id})">💾 Simpan</button>
        <button class="sp-del-btn" style="flex:1;padding:6px" onclick="cancelEdit(this)">✕ Batal</button>
      </div>
    </div>`);
}

async function saveEditReminder(id) {
  const msg = document.getElementById(`edit-rem-msg-${id}`)?.value.trim();
  const dt  = document.getElementById(`edit-rem-dt-${id}`)?.value;
  const rep = document.getElementById(`edit-rem-rep-${id}`)?.value;
  if (!msg) return alert('Pesan tidak boleh kosong!');
  const body = { message: msg };
  if (dt)  body.remindAt   = new Date(dt).toISOString();
  if (rep) body.repeatType = rep;
  const r = await fetch(`/api/reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (d.ok) loadReminders();
  else alert('Gagal: ' + (d.message || 'Unknown error'));
}

// ════════════════════════════════════
// EDIT NOTE
// ════════════════════════════════════

async function showEditNote(id, btn) {
  const item = btn.closest('.sp-item');
  if (!item || item.querySelector('.sp-edit-form')) return;
  const r = await fetch(`/api/notes/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!d.ok) return;
  const n = d.note;
  const tagEmoji = { general:'📝', server:'🖥️', config:'⚙️', network:'🌐', personal:'👤' };
  const tagsOpts = ['general','server','config','network','personal']
    .map(t => `<option value="${t}" ${t===n.tag?'selected':''}>${tagEmoji[t]} ${t}</option>`).join('');
  item.querySelector('.sp-item-btns').insertAdjacentHTML('beforebegin', `
    <div class="sp-edit-form">
      <input type="text" class="sp-edit-input" id="edit-note-title-${id}" value="${n.title.replace(/"/g,'&quot;')}" placeholder="Judul...">
      <textarea class="sp-edit-input" id="edit-note-content-${id}" rows="4" placeholder="Isi catatan...">${n.content}</textarea>
      <select class="sp-edit-input" id="edit-note-tag-${id}">${tagsOpts}</select>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="sp-submit" style="flex:1;padding:6px" onclick="saveEditNote(${id})">💾 Simpan</button>
        <button class="sp-del-btn" style="flex:1;padding:6px" onclick="cancelEdit(this)">✕ Batal</button>
      </div>
    </div>`);
}

async function saveEditNote(id) {
  const title   = document.getElementById(`edit-note-title-${id}`)?.value.trim();
  const content = document.getElementById(`edit-note-content-${id}`)?.value.trim();
  const tag     = document.getElementById(`edit-note-tag-${id}`)?.value;
  if (!title || !content) return alert('Judul dan isi tidak boleh kosong!');
  const r = await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, content, tag })
  });
  const d = await r.json();
  if (d.ok) loadNotes(currentNoteTag);
  else alert('Gagal: ' + (d.message || 'Unknown error'));
}

function cancelEdit(btn) {
  btn.closest('.sp-edit-form')?.remove();
}