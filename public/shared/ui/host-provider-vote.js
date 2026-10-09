// Host provider selection only. Test access continues the existing Spotify OAuth flow.
(function () {
  let dialog;
  window.AhOuaiHostProviderVote = {
    open(onTestAccess) {
      if (dialog?.open) return;
      if (!document.getElementById('host-provider-vote-style')) {
        const style = document.createElement('style');
        style.id = 'host-provider-vote-style';
        style.textContent = `
          .host-provider-vote{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:28px;border:1px solid #33d6c480;border-radius:26px;background:linear-gradient(140deg,#071723,#20103c);color:#fff;font-family:inherit;text-align:center}
          .host-provider-vote::backdrop{background:#020612c9;backdrop-filter:blur(6px)}
          .host-provider-vote img{width:150px;max-width:70%}.host-provider-vote h2{font-size:26px;line-height:1.2}.host-provider-vote p{color:#b9bbce;line-height:1.5}
          .host-provider-vote button{display:block;width:100%;min-height:44px;margin-top:12px;border-radius:14px;padding:12px;border:1px solid #74718d;background:transparent;color:#d2cde0;font:inherit;cursor:pointer}
          .host-provider-vote .provider-vote-submit{background:#1db954;color:#05120a;font-weight:700;border:0}.host-provider-vote button:disabled{opacity:.6;cursor:default}.host-provider-vote .provider-vote-test{font-size:13px;border:0;text-decoration:underline}.host-provider-vote button:focus-visible{outline:3px solid #41ded2;outline-offset:3px}
        `;
        document.head.appendChild(style);
      }
      const panel = document.createElement('dialog');
      dialog = panel;
      panel.className = 'host-provider-vote';
      panel.setAttribute('aria-labelledby', 'host-provider-vote-title');
      panel.innerHTML = `<img src="/assets/ahouai-wordmark.png" alt="AhOuai">
        <p>SPOTIFY · BIENTÔT DISPONIBLE</p><h2 id="host-provider-vote-title">Tu veux Spotify sur AhOuai ?</h2>
        <p>Spotify n’est pas encore disponible pour tous — Soon. Vote pour nous aider à préparer son ouverture.</p>
        <p class="provider-vote-status" role="status" aria-live="polite">Chargement du compteur…</p>
        <button type="button" class="provider-vote-submit">Voter pour Spotify</button>
        <button type="button" class="provider-vote-test">J’ai un jeton de test valide</button>
        <button type="button" class="provider-vote-close" autofocus>Fermer</button>`;
      document.body.appendChild(panel);
      const status = panel.querySelector('.provider-vote-status');
      const vote = panel.querySelector('.provider-vote-submit');
      let voting = false, voted = false, continuing = false;
      panel.addEventListener('close', () => { panel.remove(); if (dialog === panel) dialog = null; });
      panel.querySelector('.provider-vote-close').onclick = () => panel.close();
      panel.querySelector('.provider-vote-test').onclick = () => {
        if (continuing) return;
        continuing = true;
        panel.close();
        onTestAccess();
      };
      vote.onclick = async () => {
        if (voting || voted) return;
        voting = true; vote.disabled = true;
        try {
          const token = typeof getProfileJwt === 'function' ? await getProfileJwt() : null;
          if (!token) throw new Error('Connecte ton compte AhOuai pour voter.');
          const response = await fetch('/api/user/vote/provider', { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ provider: 'spotify' }) });
          if (!response.ok) throw new Error('Vote non enregistré. Réessaie dans un instant.');
          const result = await response.json();
          voted = true; vote.textContent = 'Voté ✓';
          status.textContent = `Merci ! ${result.count || 0} vote(s) pour Spotify.`;
        } catch (error) { status.textContent = error.message; }
        finally { voting = false; vote.disabled = voted; }
      };
      panel.showModal();
      fetch('/api/user/vote/counts').then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(counts => { if (!voting && !voted) status.textContent = `${counts.spotify || 0} vote(s) pour Spotify.`; })
        .catch(() => { if (!voting && !voted) status.textContent = 'Compteur indisponible. Tu peux quand même voter.'; });
    }
  };
})();
