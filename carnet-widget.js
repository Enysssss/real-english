(function () {
  const LOCAL_KEY = 'carnet-vocab';
  const POS_KEY = 'carnet-modal-pos';

  let entries = [];
  let mode = 'anon'; // 'anon' | 'account'
  let username = null;
  let carnetOpen = false;
  let authOpen = false;
  let signupMode = false;
  let carnetGloballyEnabled = true;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function loadLocalEntries() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveLocalEntries() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(entries)); } catch (e) { /* ignore */ }
  }

  async function api(path, options) {
    const res = await fetch('/api' + path, {
      method: (options && options.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error(data.error || 'Erreur.');
    return data;
  }

  // ---------- CSS ----------
  const style = document.createElement('style');
  style.textContent = `
    #authWidget{ position:fixed; top:16px; right:16px; z-index:9998; font-family:"IBM Plex Sans", sans-serif; }
    #authToggle{
      background:var(--brass); color:#1c1305; border:none; border-radius:999px;
      padding:8px 16px; font-weight:600; font-size:13px; cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,.35);
    }
    #authToggle:hover{ background:var(--brass-light); }
    #authPopover{
      display:none; position:absolute; top:calc(100% + 8px); right:0;
      background:var(--paper); color:var(--ink); border-radius:8px; padding:14px;
      width:220px; box-shadow:0 12px 30px rgba(0,0,0,.4); font-size:12.5px;
    }
    #authPopover.open{ display:block; }
    #authPopover .row{ display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
    #authPopover input{
      font-size:12.5px; padding:6px 8px; border:1px solid var(--paper-shadow);
      border-radius:4px; background:#fff; color:var(--ink);
    }
    #authPopover button.primary{
      font-size:12.5px; font-weight:600; padding:7px 10px; border:none; border-radius:4px;
      background:var(--blue); color:#fff; cursor:pointer; width:100%;
    }
    #authPopover .switch-link{ color:var(--blue); cursor:pointer; text-decoration:underline; font-size:11.5px; display:block; margin-top:6px; }
    #authPopover .err{ color:var(--bad,#a44444); font-size:11.5px; margin-top:6px; min-height:14px; }
    #authPopover .logout-btn{
      font-size:12.5px; font-weight:600; padding:7px 10px; border:none; border-radius:4px;
      background:var(--bad,#a44444); color:#fff; cursor:pointer; width:100%;
    }

    #carnetToggle{
      position:fixed; right:22px; bottom:22px; z-index:9998;
      font-family:"IBM Plex Sans", sans-serif; font-weight:600; font-size:14px;
      background:var(--brass); color:#1c1305; border:none; border-radius:999px;
      padding:12px 20px; cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.4);
    }
    #carnetToggle:hover{ background:var(--brass-light); }
    #carnetModal{
      position:fixed; z-index:9999; width:340px; max-width:90vw;
      background:var(--paper); color:var(--ink); border-radius:var(--radius);
      box-shadow:0 18px 40px rgba(0,0,0,.45);
      display:none; flex-direction:column; max-height:80vh;
      font-family:"IBM Plex Sans", sans-serif;
    }
    #carnetModal.open{ display:flex; }
    #carnetModal .carnet-header{
      display:flex; align-items:center; justify-content:space-between;
      background:var(--ink); color:var(--paper); padding:10px 14px;
      border-radius:var(--radius) var(--radius) 0 0; cursor:grab; user-select:none;
      font-family:"Special Elite", monospace; font-size:14px;
    }
    #carnetModal .carnet-header:active{ cursor:grabbing; }
    #carnetModal .carnet-close{ background:none; border:none; color:var(--paper); font-size:16px; cursor:pointer; padding:0 4px; }
    #carnetModal .carnet-body{ padding:14px 16px; overflow-y:auto; }
    .carnet-owner{ font-size:11.5px; color:var(--ink-soft); margin-bottom:10px; }
    .carnet-import{ font-size:12px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px dashed var(--paper-shadow); }
    .carnet-import button{
      width:100%; font-size:12px; font-weight:600; padding:7px 10px; border:none; border-radius:4px;
      background:var(--ok,#4c7a5b); color:#fff; cursor:pointer;
    }
    .carnet-form{ display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
    .carnet-form input, .carnet-form textarea{
      font-family:inherit; font-size:13px; padding:7px 9px; border:1px solid var(--paper-shadow);
      border-radius:4px; background:#fff; color:var(--ink);
    }
    .carnet-form textarea{ min-height:44px; resize:vertical; }
    .carnet-form button{
      font-weight:600; font-size:13px; padding:8px; border:none; border-radius:4px;
      background:var(--ink); color:var(--paper); cursor:pointer;
    }
    .carnet-list{ display:flex; flex-direction:column; gap:8px; }
    .carnet-card{
      border-left:3px solid var(--brass); background:rgba(32,41,58,.04);
      padding:8px 10px; border-radius:4px; font-size:13px;
    }
    .carnet-card .term{ font-weight:600; }
    .carnet-card .meaning{ color:var(--ink-soft); }
    .carnet-card .example{ color:#8b8060; font-style:italic; font-size:12px; margin-top:2px; }
    .carnet-card .del{
      float:right; background:none; border:none; color:var(--blue); text-decoration:underline;
      font-size:11px; cursor:pointer; padding:0;
    }
    .carnet-empty{ font-size:12.5px; color:var(--ink-soft); font-style:italic; }
  `;
  document.head.appendChild(style);

  // ---------- auth widget markup (global, top-right) ----------
  const authWidget = document.createElement('div');
  authWidget.id = 'authWidget';
  authWidget.innerHTML = `
    <button id="authToggle"></button>
    <div id="authPopover"></div>
  `;
  document.body.appendChild(authWidget);
  const authToggleBtn = authWidget.querySelector('#authToggle');
  const authPopover = authWidget.querySelector('#authPopover');

  authToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    authOpen = !authOpen;
    authPopover.classList.toggle('open', authOpen);
  });
  authPopover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    if (authOpen) {
      authOpen = false;
      authPopover.classList.remove('open');
    }
  });

  // ---------- carnet modal markup (bottom-right) ----------
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'carnetToggle';
  toggleBtn.textContent = '📔 Carnet';
  document.body.appendChild(toggleBtn);

  const modal = document.createElement('div');
  modal.id = 'carnetModal';
  modal.innerHTML = `
    <div class="carnet-header">
      <span>Mon carnet</span>
      <button class="carnet-close" aria-label="Fermer">✕</button>
    </div>
    <div class="carnet-body">
      <div class="carnet-owner" id="carnetOwner"></div>
      <div class="carnet-import" id="carnetImportBox" style="display:none;">
        <button id="carnetImport"></button>
      </div>
      <div class="carnet-form">
        <input id="carnetTerm" placeholder="Mot ou expression">
        <input id="carnetMeaning" placeholder="Sens en français">
        <textarea id="carnetExample" placeholder="Exemple (optionnel)"></textarea>
        <button id="carnetAdd">Ajouter au carnet</button>
      </div>
      <div class="carnet-list" id="carnetList"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // ---------- position + drag ----------
  function applySavedPosition() {
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) { /* ignore */ }
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      modal.style.left = Math.min(pos.left, window.innerWidth - 60) + 'px';
      modal.style.top = Math.min(pos.top, window.innerHeight - 60) + 'px';
    } else {
      modal.style.right = '22px';
      modal.style.bottom = '84px';
    }
  }
  applySavedPosition();

  const header = modal.querySelector('.carnet-header');
  let dragging = false, dragOffsetX = 0, dragOffsetY = 0;
  header.addEventListener('pointerdown', (e) => {
    dragging = true;
    header.setPointerCapture(e.pointerId);
    const rect = modal.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    modal.style.right = 'auto';
    modal.style.bottom = 'auto';
    modal.style.left = rect.left + 'px';
    modal.style.top = rect.top + 'px';
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let left = e.clientX - dragOffsetX;
    let top = e.clientY - dragOffsetY;
    left = Math.max(0, Math.min(left, window.innerWidth - 60));
    top = Math.max(0, Math.min(top, window.innerHeight - 40));
    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
  });
  header.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const rect = modal.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (e) { /* ignore */ }
  });

  // ---------- enable/disable (e.g. host turns the carnet off for a multiplayer round) ----------
  function applyCarnetEnabled() {
    toggleBtn.style.display = carnetGloballyEnabled ? '' : 'none';
    if (!carnetGloballyEnabled) {
      carnetOpen = false;
      modal.classList.remove('open');
    }
  }

  // ---------- open/close carnet ----------
  toggleBtn.addEventListener('click', () => { carnetOpen = !carnetOpen; modal.classList.toggle('open', carnetOpen); });
  modal.querySelector('.carnet-close').addEventListener('click', () => { carnetOpen = false; modal.classList.remove('open'); });

  // ---------- rendering: carnet ----------
  function renderList() {
    const box = document.getElementById('carnetList');
    if (entries.length === 0) {
      box.innerHTML = '<div class="carnet-empty">Aucun mot enregistré pour l\'instant.</div>';
      return;
    }
    box.innerHTML = entries.slice().reverse().map((e) => `
      <div class="carnet-card" data-id="${escapeHtml(e.id)}">
        <button class="del">supprimer</button>
        <div class="term">${escapeHtml(e.term)}</div>
        <div class="meaning">${escapeHtml(e.meaning)}</div>
        ${e.example ? `<div class="example">${escapeHtml(e.example)}</div>` : ''}
      </div>
    `).join('');
    box.querySelectorAll('.del').forEach((btn) => {
      btn.addEventListener('click', () => deleteEntry(btn.closest('.carnet-card').dataset.id));
    });
  }

  function renderCarnetOwner() {
    const ownerEl = document.getElementById('carnetOwner');
    ownerEl.textContent = mode === 'account'
      ? `Carnet de ${username} (synchronisé)`
      : 'Carnet local — connecte-toi pour le synchroniser entre appareils.';

    const importBox = document.getElementById('carnetImportBox');
    const localCount = loadLocalEntries().length;
    if (mode === 'account' && localCount > 0) {
      importBox.style.display = 'block';
      document.getElementById('carnetImport').textContent = `Importer mes ${localCount} mot(s) locaux`;
    } else {
      importBox.style.display = 'none';
    }
  }

  // ---------- rendering: global auth widget ----------
  function renderAuthWidget(errMsg) {
    if (mode === 'account') {
      authToggleBtn.textContent = '👤 ' + username;
      authPopover.innerHTML = `
        <div style="margin-bottom:8px;">Connecté en tant que <strong>${escapeHtml(username)}</strong></div>
        <button class="logout-btn" id="authLogout">Se déconnecter</button>
      `;
      document.getElementById('authLogout').addEventListener('click', logout);
      return;
    }
    authToggleBtn.textContent = 'Se connecter';
    authPopover.innerHTML = `
      <div class="row">
        <input id="authUser" placeholder="Pseudo">
        <input id="authPass" type="password" placeholder="Mot de passe">
      </div>
      <button class="primary" id="authSubmit">${signupMode ? 'Créer mon compte' : 'Connexion'}</button>
      <span class="switch-link" id="authSwitch">${signupMode ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? En créer un'}</span>
      <div class="err">${errMsg ? escapeHtml(errMsg) : ''}</div>
    `;
    document.getElementById('authSwitch').addEventListener('click', () => {
      signupMode = !signupMode;
      renderAuthWidget();
    });
    document.getElementById('authSubmit').addEventListener('click', () => {
      const u = document.getElementById('authUser').value.trim();
      const p = document.getElementById('authPass').value;
      if (signupMode) signup(u, p); else login(u, p);
    });
  }

  // ---------- data ops ----------
  async function refreshAccountEntries() {
    const data = await api('/carnet');
    entries = data.entries;
    renderList();
    renderCarnetOwner();
  }

  async function login(u, p) {
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username: u, password: p } });
      username = data.username;
      mode = 'account';
      authOpen = false;
      authPopover.classList.remove('open');
      await refreshAccountEntries();
      renderAuthWidget();
    } catch (err) {
      renderAuthWidget(err.message);
    }
  }

  async function signup(u, p) {
    try {
      const data = await api('/auth/signup', { method: 'POST', body: { username: u, password: p } });
      username = data.username;
      mode = 'account';
      authOpen = false;
      authPopover.classList.remove('open');
      await refreshAccountEntries();
      renderAuthWidget();
    } catch (err) {
      renderAuthWidget(err.message);
    }
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    mode = 'anon';
    username = null;
    authOpen = false;
    authPopover.classList.remove('open');
    entries = loadLocalEntries();
    renderList();
    renderCarnetOwner();
    renderAuthWidget();
  }

  async function importLocalEntries() {
    const local = loadLocalEntries();
    for (const e of local) {
      try { await api('/carnet', { method: 'POST', body: { term: e.term, meaning: e.meaning, example: e.example } }); } catch (err) { /* skip failed one */ }
    }
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ }
    await refreshAccountEntries();
  }
  document.getElementById('carnetImport').addEventListener('click', importLocalEntries);

  async function addEntry(term, meaning, example) {
    if (!term.trim() || !meaning.trim()) return;
    if (mode === 'account') {
      const entry = await api('/carnet', { method: 'POST', body: { term, meaning, example } });
      entries.push(entry);
    } else {
      entries.push({ id: 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), term, meaning, example, createdAt: Date.now() });
      saveLocalEntries();
    }
    renderList();
  }

  async function deleteEntry(id) {
    if (mode === 'account') {
      try { await api('/carnet/' + id, { method: 'DELETE' }); } catch (e) { /* ignore */ }
      entries = entries.filter((e) => String(e.id) !== String(id));
    } else {
      entries = entries.filter((e) => e.id !== id);
      saveLocalEntries();
    }
    renderList();
  }

  document.getElementById('carnetAdd').addEventListener('click', () => {
    const term = document.getElementById('carnetTerm').value;
    const meaning = document.getElementById('carnetMeaning').value;
    const example = document.getElementById('carnetExample').value;
    addEntry(term, meaning, example);
    document.getElementById('carnetTerm').value = '';
    document.getElementById('carnetMeaning').value = '';
    document.getElementById('carnetExample').value = '';
  });

  // ---------- public API for quick-add from index.html / enable toggle from jouer.html ----------
  window.CarnetWidget = {
    quickAdd(prefill) {
      if (!carnetGloballyEnabled) return;
      carnetOpen = true;
      modal.classList.add('open');
      if (prefill) {
        document.getElementById('carnetTerm').value = prefill.term || '';
        document.getElementById('carnetMeaning').value = prefill.meaning || '';
        document.getElementById('carnetExample').value = prefill.example || '';
      }
      document.getElementById('carnetTerm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    setEnabled(enabled) {
      carnetGloballyEnabled = !!enabled;
      applyCarnetEnabled();
    },
  };

  // ---------- init ----------
  (async function init() {
    try {
      const data = await api('/auth/me');
      if (data.user) {
        username = data.user.username;
        mode = 'account';
        await refreshAccountEntries();
      } else {
        entries = loadLocalEntries();
        renderList();
        renderCarnetOwner();
      }
    } catch (e) {
      entries = loadLocalEntries();
      renderList();
      renderCarnetOwner();
    }
    renderAuthWidget();
  })();
})();
