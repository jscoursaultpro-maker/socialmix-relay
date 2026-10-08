/* Presentation only: the existing auth, provider and party flows own all actions. */
(() => {
  'use strict';
  const trigger = document.getElementById('host-story-open');
  const dialog = document.getElementById('host-story-dialog');
  if (!trigger || !dialog) return;
  const steps = [
    { label: '01 · TU LANCES', title: 'Ce soir,<br><span>c’est chez toi.</span>', text: 'Choisis ton lecteur, donne un nom à ta soirée et lance la musique. Tu gardes les commandes depuis ton navigateur.', example: 'Ton cockpit rassemble la musique et les outils pour piloter ta soirée.', cta: 'Et mes invités ?' },
    { label: '02 · ILS PARTICIPENT', title: 'Ton son.<br><span>Leur énergie.</span>', text: 'Partage le QR code ou le lien. Tes invités rejoignent depuis leur téléphone, proposent des titres, votent et partagent leurs photos.', example: 'Un morceau proposé. Des réactions en direct. La soirée se construit ensemble.', cta: 'Et après la soirée ?' },
    { label: '03 · ÇA RESTE', title: 'La soirée finit.<br><span>Les moments restent.</span>', text: 'Retrouve les morceaux et les photos de votre soirée dans Best Of. Les moments partagés deviennent des souvenirs à revoir.', example: 'Des gens. Des titres. Des souvenirs. La musique vous rapproche.', cta: 'Créer ma soirée' }
  ];
  let index = 0;
  const next = document.getElementById('host-story-next');
  const back = document.getElementById('host-story-back');
  function render() {
    const step = steps[index];
    document.getElementById('host-story-step').textContent = step.label;
    document.getElementById('host-story-title').innerHTML = step.title;
    document.getElementById('host-story-text').textContent = step.text;
    document.getElementById('host-story-example').textContent = step.example;
    next.textContent = step.cta + ' →';
    back.hidden = index === 0;
  }
  trigger.addEventListener('click', () => { index = 0; render(); dialog.showModal(); });
  document.getElementById('host-story-close').addEventListener('click', () => dialog.close());
  back.addEventListener('click', () => { if (index > 0) index--; render(); });
  next.addEventListener('click', () => {
    if (index < steps.length - 1) { index++; render(); return; }
    dialog.close();
    if (typeof window.goCreateParty === 'function') window.goCreateParty();
  });
})();
