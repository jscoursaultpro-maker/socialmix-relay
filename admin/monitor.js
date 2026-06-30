// ─── Deep-link URL param support ──────────────────────────
// Reads ?filter=X from URL and pre-checks the matching radio
// Called at boot (if already authed) and post-login
function applyFilterFromURL() {
  const params = new URLSearchParams(window.location.search);
  const f = params.get('filter');
  if (!f) return;

  // Try to find a matching radio by value
  const radio = document.querySelector(`input[name="f-type"][value="${CSS.escape(f)}"]`);
  if (radio) {
    // Uncheck current default
    document.querySelectorAll('input[name="f-type"]').forEach(r => r.checked = false);
    radio.checked = true;
    // Scroll sidebar to make it visible
    radio.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Show ghost filter banner if it's a ghost filter
  const GHOST_FILTERS = ['ghost_no_phase', 'ghost_no_bpm', 'ghost_no_rank',
    'incoherent_arrival_high', 'incoherent_groove_low', 'incoherent_closing_electro'];
  if (GHOST_FILTERS.includes(f)) {
    const GHOST_LABELS = {
      ghost_no_phase:            '🏚️ Orphelines — sans phase assignée',
      ghost_no_bpm:              '🥁 Sans BPM',
      ghost_no_rank:             '📊 Sans rank Deezer',
      incoherent_arrival_high:   '🌡️ Arrival/ambiance + energy > 7',
      incoherent_groove_low:     '🪫 Groove/party + energy < 4',
      incoherent_closing_electro:'💀 Closing + electro hard + BPM > 150'
    };
    let banner = document.getElementById('ghost-filter-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'ghost-filter-banner';
      banner.style.cssText = 'background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.3);border-radius:8px;padding:8px 14px;margin:8px 16px;font-size:12px;color:#a78bfa;display:flex;align-items:center;gap:8px;';
      const topBar = document.getElementById('stats-top-bar');
      if (topBar && topBar.nextSibling) {
        topBar.parentNode.insertBefore(banner, topBar.nextSibling);
      }
    }
    banner.innerHTML = `<span>👻 Filtre Ghost actif :</span><strong>${GHOST_LABELS[f] || f}</strong><a href="/admin/ghost.html" style="margin-left:auto;color:#a78bfa;font-size:11px;">← Retour Ghost Manager</a>`;
  }
}

let adminToken = null;
let tracks = [];
let currentIdx = -1;
let isPlaying = false;
let sessionStats = { startTime: Date.now(), count: 0 };

const GENRES = ['House','Electro','Disco','Pop','Hip-Hop','R&B','Latin','Reggaeton','Afro','Rock','COCOVARIET','Chill','Ambient','Jazz','Classical','Folk, World, & Country','Non-Music','Unknown'];
const PHASES = ['arrival','ambiance','takeoff','groove','party','closing'];
const UI_CATEGORIES = ["Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro"];
const ERAS = ["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"];
const MOODS = ["fun", "emotional", "aggressive", "chill"];

// Single global audio element
const audioEl = new Audio();
audioEl.preload = 'none';

window.addEventListener('load', async () => {
  const saved = localStorage.getItem('monitor_token');
  if (saved) {
    adminToken = saved;
    const r = await fetch('/api/monitor/live-stats', { headers: { 'x-admin-token': adminToken } });
    if (r.ok) {
      document.getElementById('auth-screen').style.display = 'none';
      document.getElementById('app').classList.add('visible');
      updateStats();
      setInterval(updateStats, 10000);
      applyFilterFromURL(); // ★ deep-link: pre-check radio from ?filter=
      loadTracks();
      return;
    }
    localStorage.removeItem('monitor_token');
  }
  document.getElementById('auth-input').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  
  // Setup global keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeydown);
});

async function login() {
  const pw = document.getElementById('auth-input').value;
  const r = await fetch('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  if (!r.ok) {
    document.getElementById('auth-error').style.display = 'block';
    return;
  }
  const { token } = await r.json();
  adminToken = token;
  localStorage.setItem('monitor_token', token);
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  updateStats();
  applyFilterFromURL(); // ★ deep-link: pre-check radio from ?filter= post-login
  loadTracks();
}

function api(method, path, body) {
  return fetch(path, {
    method,
    headers: { 'x-admin-token': adminToken, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => {
    if (r.status === 401) {
      document.getElementById('auth-overlay').style.display = 'flex';
      throw new Error("Unauthorized (veuillez vous reconnecter)");
    }
    if (!r.ok) throw new Error(`API Error: ${r.statusText}`);
    return r.json();
  });
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── Stats & API ──────────────────────────────────────────
async function updateStats() {
  try {
    const s = await api('GET', '/api/monitor/live-stats');
    
    document.getElementById('badge-total').textContent = `Total: ${s.total}`;
    
    const compTotal = (s.byQuality.complete || 0) + (s.byQuality.platine || 0);
    const compPct = s.total > 0 ? Math.round(compTotal / s.total * 100) : 0;
    document.getElementById('badge-complete').textContent = `✅ Complètes: ${s.byQuality.complete || 0} (${compPct}%)`;
    
    const platPct = s.total > 0 ? Math.round((s.byQuality.platine || 0) / s.total * 100) : 0;
    document.getElementById('badge-platine').textContent = `⭐ Platine: ${s.byQuality.platine || 0} (${platPct}%)`;
    
    document.getElementById('badge-partielle').textContent = `🟡 Partielles: ${s.byQuality.partielle || 0}`;
    document.getElementById('badge-vide').textContent = `🔴 Vides: ${s.byQuality.vide || 0}`;
    
    document.getElementById('badge-session').textContent = `🎯 Aujourd'hui: +${s.today.complete} ✅ +${s.today.platine} ⭐`;
    document.getElementById('badge-speed').textContent = `Vitesse: ${s.speedPerMin}/min`;
    
    let eta = '--';
    if (s.etaMinutes > 0) {
      if (s.etaMinutes > 60) eta = `${(s.etaMinutes/60).toFixed(1)}h`;
      else eta = `${s.etaMinutes}m`;
    }
    document.getElementById('badge-eta').textContent = `🏆 ETA tout finir: ${eta}`;
    
    // Bottom bar
    const bb = document.getElementById('bottom-stats');
    if (bb) bb.textContent = `Aujourd'hui : ${s.today.complete + s.today.platine} tracks complètes | Vitesse : ${s.speedPerMin} tracks/min | ETA finir : ${eta}`;
    
    // Modal Stats
    const minD = document.getElementById('modal-duration');
    if (minD) minD.textContent = s.speedPerMin > 0 ? `${Math.round((s.today.complete + s.today.platine) / s.speedPerMin)} min` : '-- min';
    const mc = document.getElementById('modal-classified');
    if (mc) mc.textContent = (s.today.complete + s.today.platine) + " tracks";
    const mp = document.getElementById('modal-partielle');
    if (mp) mp.textContent = s.byQuality.partielle || 0;
    const mcp = document.getElementById('modal-complete');
    if (mcp) mcp.textContent = s.byQuality.complete || 0;
    const mpl = document.getElementById('modal-platine');
    if (mpl) mpl.textContent = s.byQuality.platine || 0;
    const msp = document.getElementById('modal-speed');
    if (msp) msp.textContent = `${s.speedPerMin} tracks/min`;
    const mpr = document.getElementById('modal-progress');
    if (mpr) mpr.textContent = `${compPct}%`;

    // Phase Progress Sidebar
    let html = '';
    const phases = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];
    for (const p of phases) {
      const d = s.phaseProgress[p];
      if (!d) continue;
      let status = 'vide';
      let emoji = '🔴';
      if (d.percent >= 80) { status = 'platine'; emoji = '⭐'; }
      else if (d.percent >= 50) { status = 'complete'; emoji = '✅'; }
      else if (d.percent >= 15) { status = 'partielle'; emoji = '🟡'; }
      html += `<div class="phase-item" onclick="loadPhaseSuggestion('${p}')">
        <span>🌙 ${p.charAt(0).toUpperCase() + p.slice(1)} ${d.complete}/${d.total} (${d.percent}%)</span>
        <span class="status ${status}">${emoji}</span>
      </div>`;
    }
    const pl = document.getElementById('phase-list');
    if (pl) pl.innerHTML = html;

  } catch (e) {
    console.error('Stats error:', e);
  }
}

// ─── Load Tracks ──────────────────────────────────────────
async function applyFilter() {
  currentIdx = -1;
  loadTracks();
}

async function loadPhaseSuggestion(phase) {
  currentIdx = -1;
  await loadTracks(phase);
}

async function loadTracks(phaseSuggestion = null) {
  try {
    const filterParts = [];
    if (document.getElementById('f-no-phase').checked) filterParts.push('phase=unclassified');
    // We could add more specific back-end logic, but for now we map it to existing queries or add new ones.
    
    const genre = document.getElementById('f-genre').value;
    const sort = document.getElementById('f-sort').value;
    const limit = document.getElementById('f-limit').value;
    const source = document.getElementById('f-source').value;

    const params = new URLSearchParams();
    const filterType = document.querySelector('input[name="f-type"]:checked')?.value || 'all';
    params.set('filter', filterType);
    params.set('genre', genre);
    params.set('sort', sort);
    params.set('limit', limit);
    params.set('source', source);
    if (document.getElementById('f-no-phase').checked) params.set('phase', 'unclassified');
    if (phaseSuggestion) params.set('phaseSuggestion', phaseSuggestion);
    
    const data = await api('GET', `/api/monitor/tracks?${params.toString()}`);
    tracks = data.tracks || [];
    window._lastDataTotal = data.total || 0;
    
    if (tracks.length > 0) {
      if (window.viewMode === 'table') {
        renderTable();
      } else {
        selectTrack(0);
      }
    } else {
      document.getElementById('editor').innerHTML = `<div class="empty-state"><div class="icon">✅</div><p>Aucun titre trouvé pour ces filtres.</p></div>`;
      document.getElementById('table-tbody').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">Aucun titre trouvé.</td></tr>`;
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showStatsModal() {
  document.getElementById('stats-modal').style.display = 'flex';
}

function closeStatsModal() {
  document.getElementById('stats-modal').style.display = 'none';
}

function playUpgradeAnimation(oldQ, newQ) {
  if (oldQ === newQ) return;
  const container = document.body;
  const flash = document.createElement('div');
  flash.className = `anim-flash-container`;
  
  if (newQ === 'complete') {
    flash.innerHTML = `<div class="anim-flash complete">✅ UPGRADE: COMPLÈTE</div>`;
  } else if (newQ === 'platine') {
    flash.innerHTML = `<div class="anim-flash platine">⭐ UPGRADE: PLATINE</div>`;
    // Confetti simulation
    for(let i=0; i<20; i++) {
      const conf = document.createElement('div');
      conf.style.position = 'absolute';
      conf.style.width = '10px';
      conf.style.height = '10px';
      conf.style.background = ['#ffd700', '#ff0000', '#00ff00', '#0000ff'][Math.floor(Math.random()*4)];
      conf.style.left = Math.random() * 100 + '%';
      conf.style.top = '-20px';
      conf.style.transition = 'all 2s ease-out';
      flash.appendChild(conf);
      setTimeout(() => {
        conf.style.top = (Math.random() * 200 + 100) + 'px';
        conf.style.transform = `rotate(${Math.random() * 360}deg)`;
        conf.style.opacity = '0';
      }, 50);
    }
  }
  
  if (flash.innerHTML) {
    container.appendChild(flash);
    setTimeout(() => { flash.remove(); }, 2500);
  }
}

// ─── Render Single Track ──────────────────────────────────
function selectTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  currentIdx = idx;
  stopAudio();
  renderEditor();
}

function renderEditor() {
  const t = tracks[currentIdx];
  const editor = document.getElementById('editor');
  const tpl = document.getElementById('tpl-editor').content.cloneNode(true);
  
  editor.innerHTML = '';
  editor.appendChild(tpl);
  
  document.getElementById('track-current').textContent = currentIdx + 1;
  document.getElementById('track-total').textContent = tracks.length;
  if (document.getElementById('track-total-db')) document.getElementById('track-total-db').textContent = window._lastDataTotal || 0;
  
  // Zone A
  document.getElementById('track-title').textContent = `"${t.title}" — ${typeof t.artist === 'object' ? t.artist.name : t.artist}`;
  
  const qBadge = document.getElementById('track-quality-badge');
  if (qBadge) {
    const q = t.qualityLevel || 'vide';
    qBadge.className = `badge-quality badge-${q}`;
    qBadge.textContent = q === 'vide' ? '🔴 VIDE' : 
                         q === 'partielle' ? '🟡 PARTIELLE' : 
                         q === 'complete' ? '✅ COMPLÈTE' : '⭐ PLATINE';
  }
  
  // Phase Suggestion Badge
  let titleEl = document.getElementById('track-title').parentElement;
  let oldSug = document.getElementById('phase-sug-badge');
  if (oldSug) oldSug.remove();
  if (t._suggestedPhase) {
    let scoreText = t._phaseScore ? ` (score ${t._phaseScore})` : '';
    titleEl.insertAdjacentHTML('beforeend', `<span id="phase-sug-badge" class="target-phase-badge">🎯 Best for ${t._suggestedPhase}${scoreText}</span>`);
  }
  
  const fallbackSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%23333'/><text x='40' y='45' font-size='24' text-anchor='middle' fill='%23666'>🎵</text></svg>";
  const coverUrl = t.coverArtURL || (t.providers?.deezer?.album?.cover_medium) || fallbackSvg;
  document.getElementById('track-cover').src = coverUrl;
  document.getElementById('track-album').textContent = t.album || '-';
  document.getElementById('track-year').textContent = t.releaseYear || '-';
  
  const m = Math.floor((t.duration||0) / 60);
  const s = (t.duration||0) % 60;
  document.getElementById('track-duration').textContent = t.duration ? `${m}:${s.toString().padStart(2,'0')}` : '-';
  
  const rnk = t.deezerRank || 0;
  let rankStr = rnk > 0 ? `#${Math.round(rnk/1000)}k` : 'N/A';
  if (rnk > 0 && rnk <= 100000) rankStr += ' 🔥';
  else if (rnk > 100000 && rnk <= 500000) rankStr += ' ⭐';
  else if (rnk > 500000 && rnk <= 1000000) rankStr += ' ✨';
  document.getElementById('track-rank').textContent = rankStr;
  
  document.getElementById('track-isrc').textContent = t.isrc || '-';
  document.getElementById('track-source').textContent = t.source || '-';
  document.getElementById('track-lang').textContent = t.language || '-';
  
  // Columns Rendering
  const col1 = document.getElementById('col1-fields');
  const col2 = document.getElementById('col2-fields');
  const col3 = document.getElementById('col3-fields');
  
  const gpt = t.gpt_suggestion || t.gptSuggestion || {};
  
  function makeField(label, key, histVal, gptVal, inputHTML) {
    return `<div class="field-row-3"><div class="field-label">${label}</div><div class="field-val-history">${histVal !== undefined && histVal !== null && histVal !== '' ? histVal : '-'}</div></div>`;
  }
  function makeFieldCol2(gptVal) {
    return `<div class="field-row-3"><div class="field-val-gpt">${gptVal !== undefined && gptVal !== null && gptVal !== '' ? gptVal : '-'}</div></div>`;
  }
  function makeFieldCol3(inputHTML) {
    return `<div class="field-row-3"><div class="field-val-adjust">${inputHTML}</div></div>`;
  }

  const addRow = (label, key, histVal, gptVal, inputHTML) => {
    col1.innerHTML += makeField(label, key, histVal, gptVal, inputHTML);
    col2.innerHTML += makeFieldCol2(gptVal);
    col3.innerHTML += makeFieldCol3(inputHTML);
  };

  // --- Genre ---
  const genreOpts = GENRES.map(g => `<option value="${g}" ${(t.genre||'')===g ? 'selected':''}>${g}</option>`).join('');
  addRow('Genre', 'genre', t.genre, gpt.genreBDD, `<select id="inp-genre">${genreOpts}</select>`);
  if(gpt.genreBDD && GENRES.includes(gpt.genreBDD)) setTimeout(() => { document.getElementById('inp-genre').value = gpt.genreBDD; }, 0);

  // --- UI Category Primary ---
  const catOpts = [''].concat(UI_CATEGORIES).map(c => `<option value="${c}" ${(t.uiCategoryPrimary||'')===c ? 'selected':''}>${c||'--'}</option>`).join('');
  addRow('UI Category', 'uiCategoryPrimary', t.uiCategoryPrimary, gpt.uiCategoryPrimary, `<select id="inp-uicat" onchange="updateSecondaryDropdowns()">${catOpts}</select>`);
  if(gpt.uiCategoryPrimary && UI_CATEGORIES.includes(gpt.uiCategoryPrimary)) setTimeout(() => { document.getElementById('inp-uicat').value = gpt.uiCategoryPrimary; }, 0);

  // --- UI Categories Secondary 1 & 2 ---
  const sec1 = (t.uiCategoriesSecondary && t.uiCategoriesSecondary.length > 0) ? t.uiCategoriesSecondary[0] : '';
  const sec2 = (t.uiCategoriesSecondary && t.uiCategoriesSecondary.length > 1) ? t.uiCategoriesSecondary[1] : '';
  const histSec = (t.uiCategoriesSecondary || []).join(', ');
  const gptSec1 = (gpt.uiCategoriesSecondary && gpt.uiCategoriesSecondary.length > 0) ? gpt.uiCategoriesSecondary[0] : '';
  const gptSec2 = (gpt.uiCategoriesSecondary && gpt.uiCategoriesSecondary.length > 1) ? gpt.uiCategoriesSecondary[1] : '';
  
  addRow('UI Secondary 1', 'sec1', histSec, (gpt.uiCategoriesSecondary || []).join(', '), `<select id="inp-uicat-sec1" onchange="updateSecondaryDropdowns()"></select>`);
  addRow('UI Secondary 2', 'sec2', '', '', `<select id="inp-uicat-sec2" onchange="updateSecondaryDropdowns()"></select>`);

  // Phase
  const phaseOpts = [''].concat(PHASES).map(p => `<option value="${p}" ${(t.phase||'')===p ? 'selected':''}>${p||'--'}</option>`).join('');
  addRow('Phase', 'phase', t.phase, gpt.phase, `<select id="inp-phase">${phaseOpts}</select>`);
  if(gpt.phase && PHASES.includes(gpt.phase)) setTimeout(() => { document.getElementById('inp-phase').value = gpt.phase; }, 0);

  // Phase Alternate
  const phaseAltOpts = ['—'].concat(PHASES).map(p => `<option value="${p}" ${(t.phaseAlternate||'—')===p ? 'selected':''}>${p}</option>`).join('');
  addRow('Phase Alt.', 'phaseAlternate', t.phaseAlternate, gpt.phaseAlternate, `<select id="inp-phasealt">${phaseAltOpts}</select>`);
  if(gpt.phaseAlternate && PHASES.includes(gpt.phaseAlternate)) setTimeout(() => { document.getElementById('inp-phasealt').value = gpt.phaseAlternate; }, 0);

  // Energy
  addRow('Energy (1-10)', 'energy', t.energy, gpt.energy, `<input type="number" id="inp-energy" min="1" max="10" value="${t.energy || ''}" />`);
  if(gpt.energy) setTimeout(() => { document.getElementById('inp-energy').value = gpt.energy; }, 0);

  // BPM
  addRow('BPM', 'bpm', t.bpm, gpt.bpm, `<input type="number" id="inp-bpm" min="60" max="220" value="${t.bpm || ''}" />`);
  if(gpt.bpm) setTimeout(() => { document.getElementById('inp-bpm').value = gpt.bpm; }, 0);

  // Era
  const eraOpts = [''].concat(ERAS).map(e => `<option value="${e}" ${(t.era||'')===e ? 'selected':''}>${e||'--'}</option>`).join('');
  addRow('Era', 'era', t.era, gpt.era, `<select id="inp-era">${eraOpts}</select>`);
  if(gpt.era && ERAS.includes(gpt.era)) setTimeout(() => { document.getElementById('inp-era').value = gpt.era; }, 0);

  // Mood
  const moodOpts = ['—'].concat(MOODS).map(m => `<option value="${m}" ${(t.mood||'—')===m ? 'selected':''}>${m}</option>`).join('');
  addRow('Mood', 'mood', t.mood, gpt.mood, `<select id="inp-mood">${moodOpts}</select>`);
  if(gpt.mood && MOODS.includes(gpt.mood)) setTimeout(() => { document.getElementById('inp-mood').value = gpt.mood; }, 0);

  // Language
  const langs = ['—', 'FR', 'EN', 'ES', 'PT', 'autre'];
  const langOpts = langs.map(l => `<option value="${l}" ${(t.language||'—')===l ? 'selected':''}>${l}</option>`).join('');
  addRow('Langue', 'language', t.language, gpt.language, `<select id="inp-language">${langOpts}</select>`);
  if(gpt.language) setTimeout(() => { document.getElementById('inp-language').value = gpt.language; }, 0);

  // Danceability
  addRow('Danceability', 'danceability', t.danceability, gpt.danceability, `<input type="number" step="0.1" id="inp-dance" min="0" max="1" value="${t.danceability !== null ? t.danceability : ''}" />`);
  if(gpt.danceability !== undefined) setTimeout(() => { document.getElementById('inp-dance').value = gpt.danceability; }, 0);

  // Checkboxes
  const makeCb = (id, label, val, gptVal, key) => {
    addRow(label, key, val ? 'OUI':'NON', gptVal === true ? 'OUI' : (gptVal === false ? 'NON' : '-'), `<label class="checkbox-wrap"><input type="checkbox" id="${id}" ${val ? 'checked':''} /> ${label}</label>`);
    if(gptVal !== undefined) setTimeout(() => { document.getElementById(id).checked = gptVal; }, 0);
  };
  
  makeCb('inp-banger', 'Banger (Z)', t.isBanger, gpt.isBanger, 'isBanger');
  makeCb('inp-singalong', 'Singalong (P)', t.isSingalong, gpt.isSingalong, 'isSingalong');
  makeCb('inp-emotional', 'Emotional (E)', t.isEmotional, gpt.isEmotional, 'isEmotional');
  makeCb('inp-caliente', 'Caliente (C)', t.isCaliente, gpt.isCaliente, 'isCaliente');
  makeCb('inp-hardcore', 'Hardcore (X)', t.isHardcore, gpt.isHardcore, 'isHardcore');
  makeCb('inp-filler', 'Filler (F)', t.isFiller, gpt.isFiller, 'isFiller');

  // Notes
  addRow('Notes', 'notes', t.notes, gpt.notes, `<textarea id="inp-notes" rows="2" style="width:100%; border-radius:4px; border:1px solid var(--border); background:var(--surface); color:var(--text); font-family:inherit; padding:6px; font-size:12px;">${t.notes||''}</textarea>`);
  if(gpt.notes) setTimeout(() => { document.getElementById('inp-notes').value = gpt.notes; }, 0);

  // Zone C
  const zc = document.getElementById('zone-c-fields');
  zc.innerHTML = `
    <label class="checkbox-wrap"><input type="checkbox" id="inp-verified" ${t.isVerified ? 'checked':''} /> Verified (V) — J'ai écouté et validé</label>
    <label class="checkbox-wrap"><input type="checkbox" id="inp-lyrics" ${t.hasLyrics ? 'checked':''} /> Has Lyrics (L) — Paroles présentes</label>
    <label class="checkbox-wrap"><input type="checkbox" id="inp-explicit" ${t.explicit ? 'checked':''} /> Explicit — Paroles explicites</label>
  `;
  if(gpt.hasLyrics !== undefined) setTimeout(() => { document.getElementById('inp-lyrics').checked = gpt.hasLyrics; }, 0);
  if(gpt.explicit !== undefined) setTimeout(() => { document.getElementById('inp-explicit').checked = gpt.explicit; }, 0);

  // Initialize secondary dropdowns
  setTimeout(() => { 
    updateSecondaryDropdowns(); 
    // Set initial values if they exist
    if (sec1 || gptSec1) document.getElementById('inp-uicat-sec1').value = gptSec1 || sec1 || '—';
    if (sec2 || gptSec2) document.getElementById('inp-uicat-sec2').value = gptSec2 || sec2 || '—';
    updateSecondaryDropdowns(); // re-eval
  }, 10);

  // Reasoning
  const rz = document.getElementById('gpt-reasoning');
  if (gpt.justification) {
    rz.innerHTML = `<strong>Justification GPT:</strong> ${gpt.justification}`;
    rz.style.display = 'block';
  } else {
    rz.innerHTML = '';
    rz.style.display = 'none';
  }

  // Set audio preview
  const did = t.providers?.deezer?.trackId || t.deezerID;
  if (t.previewUrl) {
    audioEl.src = t.previewUrl;
    if (document.getElementById('f-autoplay')?.checked) togglePlay();
  } else {
    fetch(`/api/admin/deezer/preview/${did}`, { headers: { 'x-admin-token': adminToken } })
      .then(r => r.json())
      .then(data => {
        if (data.preview) {
          t.previewUrl = data.preview; // cache it
          audioEl.src = data.preview;
          if (document.getElementById('f-autoplay')?.checked) togglePlay();
        }
      })
      .catch(e => console.error("No preview", e));
  }
}

function updateSecondaryDropdowns() {
  const p1 = document.getElementById('inp-uicat');
  const s1 = document.getElementById('inp-uicat-sec1');
  const s2 = document.getElementById('inp-uicat-sec2');
  if (!p1 || !s1 || !s2) return;

  const vP = p1.value;
  const vS1 = s1.value;
  const vS2 = s2.value;

  const buildOpts = (excludeArr, selectedVal) => {
    let opts = '<option value="—">—</option>';
    UI_CATEGORIES.forEach(c => {
      if (!excludeArr.includes(c)) {
        opts += `<option value="${c}" ${c===selectedVal ? 'selected':''}>${c}</option>`;
      }
    });
    return opts;
  };

  // If Primary changed to what S1 or S2 is, reset them
  let newS1 = vS1 === vP ? '—' : vS1;
  let newS2 = vS2 === vP ? '—' : vS2;
  if (newS2 === newS1 && newS1 !== '—') newS2 = '—';

  s1.innerHTML = buildOpts([vP], newS1);
  s2.innerHTML = buildOpts([vP, newS1].filter(x => x && x !== '—'), newS2);
}

// ─── Actions ──────────────────────────────────────────────
function getFormData() {
  const p1 = document.getElementById('inp-uicat').value || null;
  const s1 = document.getElementById('inp-uicat-sec1').value;
  const s2 = document.getElementById('inp-uicat-sec2').value;
  const secs = [s1, s2].filter(x => x && x !== '—');

  return {
    genre: document.getElementById('inp-genre').value,
    uiCategoryPrimary: p1,
    uiCategoriesSecondary: secs,
    phase: document.getElementById('inp-phase').value || null,
    phaseAlternate: document.getElementById('inp-phasealt').value === '—' ? null : document.getElementById('inp-phasealt').value,
    energy: parseInt(document.getElementById('inp-energy').value) || 0,
    bpm: parseInt(document.getElementById('inp-bpm').value) || 0,
    era: document.getElementById('inp-era').value || null,
    mood: document.getElementById('inp-mood').value === '—' ? null : document.getElementById('inp-mood').value,
    language: document.getElementById('inp-language').value === '—' ? null : document.getElementById('inp-language').value,
    danceability: document.getElementById('inp-dance').value ? parseFloat(document.getElementById('inp-dance').value) : null,
    isBanger: document.getElementById('inp-banger').checked,
    isSingalong: document.getElementById('inp-singalong').checked,
    isEmotional: document.getElementById('inp-emotional').checked,
    isCaliente: document.getElementById('inp-caliente').checked,
    isHardcore: document.getElementById('inp-hardcore').checked,
    isFiller: document.getElementById('inp-filler').checked,
    isVerified: document.getElementById('inp-verified').checked,
    hasLyrics: document.getElementById('inp-lyrics').checked,
    explicit: document.getElementById('inp-explicit').checked,
    notes: document.getElementById('inp-notes').value || ""
  };
}

async function validateTrack() {
  const t = tracks[currentIdx];
  if (!t) return;
  const data = getFormData();
  data.action = 'validate';
  
  const did = t.providers?.deezer?.trackId || t.deezerID || t._id;
  try {
    const res = await api('PATCH', `/api/monitor/track/${t._id || did}`, data);
    sessionStats.count++;
    
    // ★ Mettre à jour l'objet en mémoire avec la réponse du serveur
    // Évite de voir les anciennes données si on revient en arrière
    tracks[currentIdx] = { ...t, ...data, gptSuggestion: null, gpt_suggestion: null, qualityLevel: res.qualityLevel || 'platine', isVerified: data.isVerified };
    
    if (res.justUpgraded) {
      playUpgradeAnimation(res.oldQuality, res.newQuality);
    }
    
    updateStats();
    nextTrack();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function skipTrack() {
  const t = tracks[currentIdx];
  if (!t) return;
  const did = t.providers?.deezer?.trackId || t.deezerID;
  try {
    await api('PATCH', `/api/monitor/track/${did}`, { action: 'skip' });
    nextTrack();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function blockTrack() {
  const t = tracks[currentIdx];
  if (!t) return;
  const did = t.providers?.deezer?.trackId || t.deezerID;
  try {
    await api('PATCH', `/api/monitor/track/${did}`, { action: 'block', blockedReason: 'Monitor V2' });
    nextTrack();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function nextTrack() {
  if (currentIdx < tracks.length - 1) {
    selectTrack(currentIdx + 1);
  } else {
    // End of batch
    showToast('Batch terminé ! Chargement du suivant...', 'info');
    loadTracks();
  }
}

function prevTrack() {
  if (currentIdx > 0) {
    selectTrack(currentIdx - 1);
  }
}

// ─── Audio ────────────────────────────────────────────────
function togglePlay() {
  if (!audioEl.src) return;
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
    document.getElementById('btn-play').textContent = '▶';
    document.getElementById('btn-play').classList.remove('playing');
  } else {
    audioEl.play().catch(e => console.log('Audio play failed', e));
    isPlaying = true;
    document.getElementById('btn-play').textContent = '⏸';
    document.getElementById('btn-play').classList.add('playing');
  }
}

window.viewMode = 'editor';

function toggleViewMode() {
  window.viewMode = window.viewMode === 'editor' ? 'table' : 'editor';
  
  if (window.viewMode === 'table') {
    document.getElementById('editor').style.display = 'none';
    document.getElementById('table-view').style.display = 'block';
    document.getElementById('btn-toggle-view').textContent = '📝 Mode Edition';
    renderTable();
  } else {
    document.getElementById('editor').style.display = 'flex';
    document.getElementById('table-view').style.display = 'none';
    document.getElementById('btn-toggle-view').textContent = '📋 Mode Tableau';
    if (tracks.length > 0) selectTrack(currentIdx);
  }
}

// ─── Table Sort State ─────────────────────────────────────
window._tableSortCol = null;
window._tableSortDir = 'asc'; // 'asc' or 'desc'

function sortTable(col) {
  if (window._tableSortCol === col) {
    window._tableSortDir = window._tableSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    window._tableSortCol = col;
    window._tableSortDir = 'asc';
  }

  const phaseOrder = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];
  const qualityOrder = ['vide', 'partielle', 'complete', 'platine'];

  tracks.sort((a, b) => {
    let va, vb;
    if (col === 'artist') {
      va = (typeof a.artist === 'object' ? a.artist.name : a.artist || '').toLowerCase();
      vb = (typeof b.artist === 'object' ? b.artist.name : b.artist || '').toLowerCase();
    } else if (col === 'title') {
      va = (a.title || '').toLowerCase();
      vb = (b.title || '').toLowerCase();
    } else if (col === 'phase' || col === 'phaseAlternate') {
      va = phaseOrder.indexOf(a[col] || '');
      vb = phaseOrder.indexOf(b[col] || '');
      if (va === -1) va = 99;
      if (vb === -1) vb = 99;
    } else if (col === 'qualityLevel') {
      va = qualityOrder.indexOf(a[col] || 'vide');
      vb = qualityOrder.indexOf(b[col] || 'vide');
    } else if (col === 'bpm' || col === 'energy' || col === 'danceability') {
      va = a[col] || 0;
      vb = b[col] || 0;
    } else {
      va = (a[col] || '').toString().toLowerCase();
      vb = (b[col] || '').toString().toLowerCase();
    }

    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else if (va < vb) cmp = -1;
    else if (va > vb) cmp = 1;

    return window._tableSortDir === 'asc' ? cmp : -cmp;
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('table-tbody');

  // Update sort icons
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    const col = th.dataset.sort;
    if (col === window._tableSortCol) {
      icon.textContent = window._tableSortDir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sorted');
    } else {
      icon.textContent = '';
      th.classList.remove('sorted');
    }
  });

  tbody.innerHTML = tracks.map((t, i) => {
    const q = t.qualityLevel || 'vide';
    const qStr = q === 'vide' ? '🔴' : q === 'partielle' ? '🟡' : q === 'complete' ? '✅' : '⭐';

    const phaseEmoji = {'arrival':'🌅','ambiance':'🥂','takeoff':'🚀','groove':'💃','party':'🔥','closing':'🌙'};
    const phaseStr = t.phase ? `${phaseEmoji[t.phase]||''} ${t.phase}` : '-';
    const phaseAltStr = t.phaseAlternate ? `${phaseEmoji[t.phaseAlternate]||''} ${t.phaseAlternate}` : '-';

    const flags = [
      t.isBanger ? '🔥' : '',
      t.isSingalong ? '🎤' : '',
      t.isEmotional ? '💜' : '',
      t.isCaliente ? '🌶' : '',
      t.isHardcore ? '⚡' : '',
    ].filter(Boolean).join('');

    const danceStr = t.danceability != null ? t.danceability.toFixed(1) : '-';

    return `
      <tr>
        <td style="font-weight:bold; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.title}</td>
        <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${typeof t.artist === 'object' ? t.artist.name : t.artist}</td>
        <td style="text-align:center;">${t.bpm || '-'}</td>
        <td>${t.genre || '-'}</td>
        <td style="color:#a78bfa;">${t.uiCategoryPrimary || '-'}</td>
        <td style="color:#64748b; font-size:0.8em;">${(t.uiCategoriesSecondary || []).join(', ') || '-'}</td>
        <td>${phaseStr}</td>
        <td>${phaseAltStr}</td>
        <td style="text-align:center;">${t.energy || '-'}</td>
        <td style="text-align:center;">${danceStr}</td>
        <td style="text-align:center; font-size:1.1em;">${flags || '-'}</td>
        <td style="text-align:center;">${qStr}</td>
        <td><button class="btn btn-primary" style="padding:4px 8px; font-size:0.8em;" onclick="window.viewMode='editor'; toggleViewMode(); selectTrack(${i})">Editer</button></td>
      </tr>
    `;
  }).join('');
}

function stopAudio() {
  audioEl.pause();
  audioEl.currentTime = 0;
  isPlaying = false;
  const btn = document.getElementById('btn-play');
  if (btn) {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  }
  const prog = document.getElementById('audio-progress');
  if (prog) prog.style.width = '0%';
}

audioEl.ontimeupdate = () => {
  if (!audioEl.duration) return;
  const pct = (audioEl.currentTime / audioEl.duration) * 100;
  const prog = document.getElementById('audio-progress');
  const time = document.getElementById('audio-time');
  if (prog) prog.style.width = pct + '%';
  if (time) time.textContent = `${Math.floor(audioEl.currentTime)}s / ${Math.floor(audioEl.duration)}s`;
};

function seekAudio(e) {
  if (!audioEl.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audioEl.currentTime = pct * audioEl.duration;
}

// ─── ChatGPT Integration ──────────────────────────────────
async function generatePrompt() {
  try {
    showToast('⏳ Génération du prompt en cours...');
    // We get IDs of current batch
    const ids = tracks.map(t => t.providers?.deezer?.trackId || t.deezerID).join(',');
    const res = await api('GET', `/api/admin/generate-prompt?ids=${ids}&count=${tracks.length}`);
    if (!res.prompt) {
      showToast(res.message || 'Aucune musique à traiter !');
      return;
    }
    await navigator.clipboard.writeText(res.prompt);
    showToast(`✅ Prompt copié ! (${res.count} musiques) Va le coller dans ChatGPT.`);
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

function importGPT() {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-modal').style.display = 'flex';
}

async function processImportGPT() {
  document.getElementById('import-modal').style.display = 'none';
  const jsonStr = document.getElementById('import-textarea').value;
  if (!jsonStr) return;

  try {
    let cleanStr = jsonStr.replace(/\r/g, '').trim();
    // Extract array if there's text around it
    const startIdx = cleanStr.indexOf('[');
    const endIdx = cleanStr.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleanStr = cleanStr.substring(startIdx, endIdx + 1);
    }
    // Also remove markdown if any remains
    cleanStr = cleanStr.replace(/```(?:json)?/gi, '').trim();
    let arr;
    try {
      arr = JSON.parse(cleanStr);
    } catch (e) {
      let fixedStr = cleanStr.replace(/}\s*{/g, '},{');
      if (!fixedStr.startsWith('[')) fixedStr = '[' + fixedStr + ']';
      arr = JSON.parse(fixedStr);
    }
    
    if (arr && arr.tracks && Array.isArray(arr.tracks)) {
      arr = arr.tracks;
    }
    if (!Array.isArray(arr)) {
      if (typeof arr === 'object' && arr !== null && (arr.id || arr.deezerID)) {
        arr = [arr];
      } else {
        throw new Error("Le JSON doit être un tableau [...] ou un objet avec un 'id'");
      }
    }
    
    showToast(`⏳ Import de ${arr.length} titres en cours...`);
    const res = await api('POST', `/api/admin/import-gpt`, { tracks: arr });
    showToast(`✅ ${res.updated}/${arr.length} suggestions importées !`);
    
    // Refresh current batch to see suggestions
    loadTracks();
  } catch(e) {
    alert("Erreur de lecture du JSON: " + e.message);
  }
}

async function syncIOS() {
  showToast('⏳ Sync iOS en cours...');
  try {
    const res = await fetch('/api/admin/sync-ios', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✅ Sync iOS terminée ! ' + (data.stdout || ''));
    } else {
      showToast('❌ Erreur sync : ' + (data.error || 'inconnu'), 'error');
    }
  } catch (e) {
    showToast('❌ Erreur : ' + e.message, 'error');
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────────
function handleGlobalKeydown(e) {
  // Ignore if focus is in an input or select
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
    // Exceptions: Enter to validate in an input? 
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      validateTrack();
    }
    return; 
  }
  
  const key = e.key.toLowerCase();
  
  if (e.shiftKey && key >= '1' && key <= '9') {
    e.preventDefault();
    const idx = parseInt(key) - 1;
    const s1 = document.getElementById('inp-uicat-sec1');
    if (s1 && idx < UI_CATEGORIES.length) {
      s1.value = UI_CATEGORIES[idx];
      updateSecondaryDropdowns();
    }
    return;
  }
  
  if (e.ctrlKey && key >= '1' && key <= '9') {
    e.preventDefault();
    const idx = parseInt(key) - 1;
    const s2 = document.getElementById('inp-uicat-sec2');
    if (s2 && idx < UI_CATEGORIES.length) {
      s2.value = UI_CATEGORIES[idx];
      updateSecondaryDropdowns();
    }
    return;
  }

  switch(key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'enter':
      e.preventDefault();
      validateTrack();
      break;
    case 's':
      e.preventDefault();
      skipTrack();
      break;
    case 'b':
      e.preventDefault();
      blockTrack();
      break;
    case 'arrowright':
      e.preventDefault();
      nextTrack();
      break;
    case 'arrowleft':
      e.preventDefault();
      prevTrack();
      break;
    case 'z':
      e.preventDefault();
      const cbZ = document.getElementById('inp-banger');
      if(cbZ) cbZ.checked = !cbZ.checked;
      break;
    case 'x':
      e.preventDefault();
      const cbX = document.getElementById('inp-hardcore');
      if(cbX) cbX.checked = !cbX.checked;
      break;
    case 'f':
      e.preventDefault();
      const cbF = document.getElementById('inp-filler');
      if(cbF) cbF.checked = !cbF.checked;
      break;
    case 'p':
      e.preventDefault();
      const cbP = document.getElementById('inp-singalong');
      if(cbP) cbP.checked = !cbP.checked;
      break;
    case 'e':
      e.preventDefault();
      const cbE = document.getElementById('inp-emotional');
      if(cbE) cbE.checked = !cbE.checked;
      break;
    case 'c':
      e.preventDefault();
      const cbC = document.getElementById('inp-caliente');
      if(cbC) cbC.checked = !cbC.checked;
      break;
    case 'v':
      e.preventDefault();
      const cbV = document.getElementById('inp-verified');
      if(cbV) cbV.checked = !cbV.checked;
      break;
    case 'l':
      e.preventDefault();
      const cbL = document.getElementById('inp-lyrics');
      if(cbL) cbL.checked = !cbL.checked;
      break;
    case 'n':
      e.preventDefault();
      const txt = document.getElementById('inp-notes');
      if(txt) txt.focus();
      break;
    case 'm':
      e.preventDefault();
      const mood = document.getElementById('inp-mood');
      if(mood) {
        const opts = Array.from(mood.options);
        const cur = mood.selectedIndex;
        mood.selectedIndex = (cur + 1) % opts.length;
      }
      break;
    case 'a':
      e.preventDefault();
      const cat = document.getElementById('inp-uicat');
      if(cat) {
        const opts = Array.from(cat.options);
        const cur = cat.selectedIndex;
        cat.selectedIndex = (cur + 1) % opts.length;
        updateSecondaryDropdowns();
      }
      break;
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
      e.preventDefault();
      const phaseSel = document.getElementById('inp-phase');
      if (phaseSel) {
        const idx = parseInt(e.key) - 1;
        if (idx < PHASES.length) phaseSel.value = PHASES[idx];
      }
      break;
  }
}

async function updateBatchStatus() {
  if (!adminToken) return;
  try {
    const res = await api('GET', '/api/monitor/batch-status');
    const badge = document.getElementById('batch-status-badge');
    if (badge) {
      badge.textContent = `📁 Batches : ${res.done}/${res.total} done | ${res.in} en attente (Rejetés: ${res.rejected})`;
    }
  } catch(e) { console.error('batch-status error', e); }
}
