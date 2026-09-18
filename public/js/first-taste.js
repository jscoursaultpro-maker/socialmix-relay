let debounceTimeout;

export function initFirstTaste(code) {
  const searchInput = document.getElementById('ft-search');
  const exploreBtn = document.getElementById('ft-explore');
  const explorePanel = document.getElementById('ft-explore-panel');
  const resultsBox = document.getElementById('ft-results');
  const moodChips = document.querySelectorAll('.mood-chip');
  const skipBtn = document.getElementById('ft-skip');

  if (skipBtn) {
    skipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/?code=${code}&sb=1&skip=1`;
    });
  }

  if (exploreBtn && explorePanel) {
    exploreBtn.addEventListener('click', () => {
      explorePanel.classList.toggle('hidden');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimeout);
      const q = e.target.value.trim();
      if (!q) {
        resultsBox.innerHTML = '';
        return;
      }
      debounceTimeout = setTimeout(() => {
        fetchSearch(code, q);
      }, 300);
    });
  }

  moodChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const mood = chip.getAttribute('data-mood');
      fetchExplore(code, mood);
    });
  });
}

async function fetchSearch(code, q) {
  const resultsBox = document.getElementById('ft-results');
  resultsBox.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Recherche...</div>';
  try {
    const res = await fetch(`/api/library/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    renderTracks(data.tracks || [], resultsBox, code);
  } catch (err) {
    resultsBox.innerHTML = '<div style="text-align:center; padding:20px; color:#ff4444;">Erreur de recherche</div>';
  }
}

async function fetchExplore(code, mood) {
  const tracksBox = document.getElementById('ft-mood-tracks');
  tracksBox.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Chargement...</div>';
  try {
    const res = await fetch(`/api/library/explore?tag=${encodeURIComponent(mood)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Explore failed');
    const data = await res.json();
    renderTracks(data.tracks || [], tracksBox, code);
  } catch (err) {
    tracksBox.innerHTML = '<div style="text-align:center; padding:20px; color:#ff4444;">Erreur</div>';
  }
}

function renderTracks(tracks, container, code) {
  if (!tracks.length) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Aucun résultat</div>';
    return;
  }
  let html = '';
  tracks.forEach((track, i) => {
    // Escape quotes in JSON
    const tJson = JSON.stringify(track).replace(/"/g, '&quot;');
    html += `
      <div class="ft-track-card" onclick="window.selectFirstTasteTrack('${code}', ${i})" data-track="${tJson}" id="ft-track-${i}">
        <img src="${track.cover_small || track.coverUrl}" class="ft-track-cover" />
        <div class="ft-track-info">
          <div class="ft-track-title">${track.title}</div>
          <div class="ft-track-artist">${track.artist?.name || track.artist}</div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.selectFirstTasteTrack = async function(code, index) {
  const el = document.getElementById(`ft-track-${index}`);
  if (!el) return;
  const track = JSON.parse(el.getAttribute('data-track'));
  
  // Show confirmation UI (inline replacement for MVP)
  el.innerHTML = `
    <div style="text-align:center; width:100%;">
      <div style="font-weight:bold; margin-bottom:8px;">${track.title}</div>
      <button class="cta-btn" onclick="event.stopPropagation(); window.submitFirstTaste('${code}', '${track.id}')">
        🚀 ENVOYER MA SUGGESTION
      </button>
    </div>
  `;
};

window.submitFirstTaste = async function(code, trackId) {
  try {
    // Call suggest endpoint (assumes existing payload format)
    const res = await fetch(`/api/party/${code}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
      credentials: 'include'
    });
    if (res.ok) {
      window.location.href = `/?code=${code}&sb=1&suggested=1`;
    } else {
      alert("Erreur lors de la suggestion.");
    }
  } catch (err) {
    alert("Erreur réseau.");
  }
};
