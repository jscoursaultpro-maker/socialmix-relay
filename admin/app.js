/* ──────────────────────────────────────────────────────────────────
   SocialMix Back Office — app.js
   Architecture : RAM-first, API calls via adminFetch()
   Contrainte : zero polling, full async/await, error-resilient
────────────────────────────────────────────────────────────────── */

// ─── State ─────────────────────────────────────────────────────────
const State = {
  token: localStorage.getItem('sm_admin_token') || null,
  currentPage: 'dashboard',
  tracks: { data: [], total: 0, page: 1, pages: 1 },
  filters: { genre: 'all', status: 'unqualified', sort: 'energy_asc', search: '', page: 1 },
  qualify: { trackId: null, trackIndex: -1, deezerTrackId: null },
  qualifyQueue: [],   // Titres à qualifier (queue séquentielle)
  momentSelection: 'all',
  tagSelection: new Set(),
};

// ─── API Base URL (same origin) ────────────────────────────────────
const API = '';   // Same origin — relay-server sert /admin et /api/*

// ─── Admin Fetch (injector token automatique) ──────────────────────
async function adminFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-admin-token': State.token, ...(options.headers || {}) };
  const res = await fetch(API + path, { ...options, headers });
  if (res.status === 401) { logout(); return null; }
  return res;
}

// ─── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Navigation ────────────────────────────────────────────────────
function navigate(page) {
  State.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  document.getElementById(`page-${page}`)?.classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'tracks')    loadTracks();
  if (page === 'parties')   loadParties();
  if (page === 'analytics') loadAnalytics();
}

// ─── Auth ───────────────────────────────────────────────────────────
async function login(password) {
  const res = await fetch(`${API}/api/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) { showLoginError('Mot de passe incorrect'); return; }
  const { token } = await res.json();
  State.token = token;
  localStorage.setItem('sm_admin_token', token);
  showApp();
}

function logout() {
  State.token = null;
  localStorage.removeItem('sm_admin_token');
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app').classList.add('active');
  navigate('dashboard');
}

// ─── Dashboard ──────────────────────────────────────────────────────
async function loadDashboard() {
  const res = await adminFetch('/api/admin/stats');
  if (!res?.ok) return;
  const d = await res.json();

  // Stats cards
  document.getElementById('stat-total').textContent = d.total ?? '—';
  document.getElementById('stat-qualified').textContent = d.qualified ?? '—';
  document.getElementById('stat-no-energy').textContent = d.noEnergy ?? '—';
  document.getElementById('stat-no-energy-2').textContent = d.noEnergy ?? '—';
  document.getElementById('stat-no-bpm').textContent = d.noBpm ?? '—';

  // Badge nav
  const badge = document.getElementById('badge-unqualified');
  badge.textContent = d.noEnergy > 0 ? d.noEnergy : '';

  // Progress
  const pct = d.total > 0 ? Math.round((d.qualified / d.total) * 100) : 0;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-bar').style.width = `${pct}%`;

  // Genre breakdown
  const genreEl = document.getElementById('genre-breakdown');
  genreEl.innerHTML = (d.byGenre || []).map(g => {
    const pct = g.count > 0 ? Math.round((g.qualified / g.count) * 100) : 0;
    return `<div class="genre-item">
      <div class="genre-name">${g._id || 'N/A'}</div>
      <div class="genre-progress"><div class="genre-fill" style="width:${pct}%"></div></div>
      <div class="genre-count">${g.qualified}/${g.count} qualifiés</div>
    </div>`;
  }).join('');

  // Top feu tracks
  const feuEl = document.getElementById('top-feu-list');
  feuEl.innerHTML = (d.topFeu || []).length === 0
    ? '<p class="empty-state">Aucune donnée encore — les soirées alimenteront cette liste</p>'
    : (d.topFeu || []).map((t, i) => `
    <div class="track-item-simple">
      <span class="track-rank">${i + 1}</span>
      <div class="track-info">
        <div class="track-title">${esc(t.title)}</div>
        <div class="track-artist">${esc(t.artist)} · ${esc(t.genre)}</div>
      </div>
      <span class="track-feu">${(t.performance?.feuRatio * 100 || 0).toFixed(0)}% 🔥</span>
      <span class="track-plays">${t.performance?.totalPlays ?? 0} plays</span>
    </div>`).join('');
}

// ─── Tracks Library ─────────────────────────────────────────────────
async function loadTracks(page = State.filters.page) {
  State.filters.page = page;
  const container = document.getElementById('tracks-container');
  container.innerHTML = '<div class="loading">Chargement</div>';

  const params = new URLSearchParams({
    page, limit: 40,
    genre:  State.filters.genre !== 'all' ? State.filters.genre : '',
    status: State.filters.status,
    sort:   State.filters.sort,
    search: State.filters.search
  });

  const res = await adminFetch(`/api/admin/tracks?${params}`);
  if (!res?.ok) { container.innerHTML = '<div class="empty-state">Erreur de chargement</div>'; return; }
  const d = await res.json();

  State.tracks = { data: d.tracks, total: d.total, page: d.page, pages: d.pages };

  if (!d.tracks.length) {
    container.innerHTML = '<div class="empty-state">✅ Aucun titre à qualifier dans ce filtre !</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  container.innerHTML = d.tracks.map((t, i) => renderTrackRow(t, i)).join('');
  renderPagination(d.page, d.pages);

  // Click handlers
  container.querySelectorAll('.btn-qualify').forEach((btn, i) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openQualifyModal(i); });
  });
  container.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', () => openQualifyModal(i));
  });
}

function renderTrackRow(t, i) {
  const hasEnergy = t.energy > 0;
  const hasBpm    = t.bpm > 0;
  const qualified = t.adminQualified;
  const cover     = t.coverArtURL
    ? `<img class="track-cover" src="${esc(t.coverArtURL)}" alt="" onerror="this.style.display='none'" />`
    : `<div class="track-cover-placeholder">🎵</div>`;

  const bpmPill  = hasBpm  ? `<span class="meta-pill good">⏱ ${t.bpm} BPM</span>` : `<span class="meta-pill warn">⏱ BPM ?</span>`;
  const ePill    = hasEnergy ? `<span class="meta-pill good">⚡ ${t.energy}/10</span>` : `<span class="meta-pill warn">⚡ energy ?</span>`;
  const feuPill  = t.performance?.totalPlays > 0
    ? `<span class="meta-pill">${(t.performance.feuRatio * 100).toFixed(0)}% 🔥 (${t.performance.totalPlays} plays)</span>` : '';

  return `<div class="track-row ${qualified ? 'is-qualified' : ''}" data-index="${i}">
    ${cover}
    <div class="track-info">
      <div class="track-title">${esc(t.title)}</div>
      <div class="track-artist">${esc(t.artist)}</div>
    </div>
    <div class="track-meta">
      <span class="meta-pill genre">${esc(t.genre)}</span>
      ${bpmPill}
      ${ePill}
      ${feuPill}
      ${qualified ? '<span class="meta-pill good">✅</span>' : ''}
    </div>
    <div class="track-actions">
      <button class="btn-qualify">${qualified ? '✏️ Éditer' : '⚡ Qualifier'}</button>
    </div>
  </div>`;
}

function renderPagination(page, pages) {
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  const start = Math.max(1, page - 2);
  const end   = Math.min(pages, page + 2);
  if (start > 1) html += `<button class="page-btn" data-page="1">1</button>${start > 2 ? '<span>…</span>' : ''}`;
  for (let p = start; p <= end; p++) html += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
  if (end < pages) html += `${end < pages - 1 ? '<span>…</span>' : ''}<button class="page-btn" data-page="${pages}">${pages}</button>`;

  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach(btn => btn.addEventListener('click', () => loadTracks(+btn.dataset.page)));
}

// ─── Qualify Modal ──────────────────────────────────────────────────
async function openQualifyModal(index) {
  const track = State.tracks.data[index];
  if (!track) return;
  State.qualify = { trackId: track._id, trackIndex: index, deezerTrackId: track.providers?.deezer?.trackId };

  // Populate modal
  document.getElementById('modal-title').textContent = track.title;
  document.getElementById('modal-artist').textContent = track.artist;
  document.getElementById('modal-current-genre').textContent = track.genre;
  document.getElementById('q-genre').value = track.genre;
  document.getElementById('q-bpm').value = track.bpm || '';
  document.getElementById('q-energy').value = track.energy || 5;
  updateEnergyBadge(track.energy || 5);

  // Moment pills
  State.momentSelection = track.partyMoment || 'all';
  document.querySelectorAll('#moment-pills .pill').forEach(p => p.classList.toggle('active', p.dataset.value === State.momentSelection));

  // Tag pills
  State.tagSelection = new Set(track.tags || []);
  document.querySelectorAll('#tag-pills .pill').forEach(p => p.classList.toggle('active', State.tagSelection.has(p.dataset.value)));

  // Cover
  const coverEl = document.getElementById('modal-cover');
  coverEl.src = track.coverArtURL || '';
  coverEl.style.display = track.coverArtURL ? 'block' : 'none';

  // Reset audio
  const audio = document.getElementById('modal-audio');
  audio.src = '';
  document.getElementById('player-status').textContent = 'Chargement du preview Deezer...';

  document.getElementById('qualify-modal').classList.remove('hidden');

  // Load Deezer preview async
  if (track.providers?.deezer?.trackId) {
    const res = await adminFetch(`/api/admin/deezer/preview/${track.providers.deezer.trackId}`);
    if (res?.ok) {
      const data = await res.json();
      if (data.preview) {
        audio.src = data.preview;
        document.getElementById('player-status').textContent = '▶ Extrait 30s — Cliquer play pour écouter';
        if (data.cover) { coverEl.src = data.cover; coverEl.style.display = 'block'; }
      } else {
        document.getElementById('player-status').textContent = 'Pas de preview disponible pour ce titre';
      }
    }
  } else {
    document.getElementById('player-status').textContent = 'Pas d\'ID Deezer — preview indisponible';
  }
}

function closeModal() {
  document.getElementById('qualify-modal').classList.add('hidden');
  const audio = document.getElementById('modal-audio');
  audio.pause();
  audio.src = '';
}

async function saveQualification(andNext = true) {
  const { trackId, trackIndex } = State.qualify;
  if (!trackId) return;

  const payload = {
    genre:          document.getElementById('q-genre').value,
    bpm:            parseInt(document.getElementById('q-bpm').value) || 0,
    energy:         parseInt(document.getElementById('q-energy').value),
    adminQualified: true,
    partyMoment:    State.momentSelection,
    tags:           [...State.tagSelection],
  };

  const res = await adminFetch(`/api/admin/tracks/${trackId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (!res?.ok) { toast('Erreur lors de la sauvegarde', 'error'); return; }

  // Mettre à jour en RAM localement (pas besoin de recharger)
  if (State.tracks.data[trackIndex]) {
    Object.assign(State.tracks.data[trackIndex], payload);
    const rows = document.querySelectorAll('.track-row');
    if (rows[trackIndex]) {
      rows[trackIndex].outerHTML = renderTrackRow(State.tracks.data[trackIndex], trackIndex);
    }
  }

  toast(`✅ "${State.tracks.data[trackIndex]?.title}" qualifié !`);

  if (andNext) {
    const nextIndex = trackIndex + 1;
    if (nextIndex < State.tracks.data.length) {
      await openQualifyModal(nextIndex);
    } else {
      closeModal();
      toast('🎉 Tous les titres de cette page qualifiés !');
      loadTracks(State.filters.page + 1 <= State.tracks.pages ? State.filters.page + 1 : 1);
    }
  } else {
    closeModal();
  }
}

function updateEnergyBadge(val) {
  const labels = ['', '💤', '😴', '🥱', '😌', '🙂', '😎', '⚡', '🔥', '💥', '🚀'];
  document.getElementById('energy-value').textContent = `${val}/10 ${labels[val] || ''}`;
}

// ─── Parties ────────────────────────────────────────────────────────
async function loadParties() {
  const res = await adminFetch('/api/admin/parties?limit=30');
  if (!res?.ok) return;
  const d = await res.json();
  const el = document.getElementById('parties-list');

  if (!d.parties?.length) { el.innerHTML = '<div class="empty-state">Aucune soirée enregistrée</div>'; return; }

  el.innerHTML = d.parties.map(p => {
    const date = new Date(p.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const guests = (p.participants || []).length;
    const tracks = (p.trackHistory || []).length;
    const suggestions = (p.suggestions || []).length;
    const ended = p.endedAt ? new Date(p.endedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'En cours';
    return `<div class="party-card">
      <div class="party-header">
        <div>
          <div class="party-code">🎉 ${esc(p.code)}</div>
          <div class="party-date">${date} → ${ended}</div>
        </div>
        <span class="badge badge-blue">${guests} guests</span>
      </div>
      <div class="party-stats">
        <div class="party-stat"><div class="party-stat-value">${tracks}</div><div class="party-stat-label">Titres joués</div></div>
        <div class="party-stat"><div class="party-stat-value">${suggestions}</div><div class="party-stat-label">Suggestions</div></div>
        <div class="party-stat"><div class="party-stat-value">${Math.round(p.vibeScore || 0)}</div><div class="party-stat-label">Vibe moyen</div></div>
      </div>
    </div>`;
  }).join('');
}

// ─── Analytics ──────────────────────────────────────────────────────
async function loadAnalytics() {
  const res = await adminFetch('/api/admin/analytics');
  if (!res?.ok) return;
  const d = await res.json();

  // By genre
  document.getElementById('analytics-genre').innerHTML = (d.byGenre || [])
    .map(g => `<div class="row">
      <span class="row-label">${esc(g._id)}</span>
      <span>${g.totalPlays} plays</span>
      <span class="row-value">${(g.avgFeuRatio * 100).toFixed(0)}% 🔥</span>
    </div>`).join('') || '<div class="empty-state">Données insuffisantes</div>';

  // Top suggested
  document.getElementById('analytics-suggested').innerHTML = (d.topSuggested || [])
    .map(t => `<div class="row">
      <span class="row-label">${esc(t.title)} — <span style="color:var(--text-dim)">${esc(t.artist)}</span></span>
      <span class="row-value">${t.suggestCount}× suggéré</span>
    </div>`).join('') || '<div class="empty-state">Aucune suggestion enregistrée</div>';

  // Top played
  document.getElementById('analytics-played').innerHTML = (d.topPlayed || [])
    .map(t => `<div class="row">
      <span class="row-label">${esc(t.title)} — <span style="color:var(--text-dim)">${esc(t.artist)}</span></span>
      <span class="row-value">${t.performance?.totalPlays ?? 0} plays</span>
    </div>`).join('') || '<div class="empty-state">Aucun historique de lecture</div>';
}

// ─── Utilities ──────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Event Listeners ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Auto-login si token existant
  if (State.token) {
    showApp();
  }

  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await login(document.getElementById('admin-password').value);
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); navigate(link.dataset.page); });
  });

  // Filters
  document.getElementById('btn-apply-filters').addEventListener('click', () => {
    State.filters.genre  = document.getElementById('filter-genre').value;
    State.filters.status = document.getElementById('filter-status').value;
    State.filters.sort   = document.getElementById('filter-sort').value;
    State.filters.search = document.getElementById('filter-search').value;
    loadTracks(1);
  });
  document.getElementById('filter-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-apply-filters').click();
  });

  // Energy slider
  document.getElementById('q-energy').addEventListener('input', (e) => updateEnergyBadge(+e.target.value));

  // Moment pills (single select)
  document.getElementById('moment-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('#moment-pills .pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    State.momentSelection = pill.dataset.value;
  });

  // Tag pills (multi select)
  document.getElementById('tag-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const val = pill.dataset.value;
    if (State.tagSelection.has(val)) { State.tagSelection.delete(val); pill.classList.remove('active'); }
    else { State.tagSelection.add(val); pill.classList.add('active'); }
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('qualify-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('qualify-modal')) closeModal();
  });

  // Qualify buttons
  document.getElementById('btn-save-next').addEventListener('click', () => saveQualification(true));
  document.getElementById('btn-skip').addEventListener('click', async () => {
    const next = State.qualify.trackIndex + 1;
    if (next < State.tracks.data.length) await openQualifyModal(next);
    else closeModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('qualify-modal');
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveQualification(true);
  });
});
