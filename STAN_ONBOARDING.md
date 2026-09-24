# STAN_ONBOARDING.md

> **Public** : Stan (Claude Desktop de Daphné) — à relire au début de chaque session où Daphné brief un changement design sur le guest legacy AhOuai.
> **Auteur** : Claude (Jean-Sé), 24/09/2026.
> **Objectif** : autonomie complète de Stan pour livrer des refontes design sans casser la prod ni écraser le travail parallèle des autres agents.

---

## 1. Contexte en 30 secondes

- Tu bosses sur le repo **`socialmix-relay`** (guest web app AhOuai — l'expérience mobile des invités pendant la soirée).
- **Daphné** = designer humaine. Elle envoie des briefs en langage naturel (souvent avec screenshot + Figma). Elle ne code pas.
- **Toi (Stan)** = tu lis, tu comprends, tu édites, tu commits, tu push. Comme moi (Claude de Jean-Sé) je le fais depuis son Mac.
- **Deploy target** : Render, auto-rebuild sur chaque push `main` (~2 min).
- **Autres agents actifs sur le même repo** : Jean-Sé + son Claude, Antigravity Gemini (Codex-like), moi. Tu n'es pas seul → **discipline git obligatoire**.

## 2. Architecture guest legacy en 90 secondes

C'est une SPA monolithique **non-framework** (pas Next.js, pas Tailwind, pas de composants). Trois fichiers principaux dans `public/` :

| Fichier | Lignes | Rôle |
|---|---|---|
| `index.html` | ~1260 | Squelette DOM statique de tous les écrans, empilés en `<div class="screen">` |
| `app.js` | ~8500 | State global + socket handlers + toutes les fonctions render/setup |
| `style.css` | ~5860 | Tous les styles, du reset à l'animation |

**Écrans (`<div class="screen">`)** — un seul est actif à la fois via la classe `.active`, contrôlée par `showScreen(name)` dans app.js.

## 3. Table "Où est quoi" (à jour 24/09/2026)

Utilise `grep`/`Read` pour zoomer, mais commence par cette table :

### Écrans (`index.html`)

| Écran | Section HTML | Fonction JS principale |
|---|---|---|
| Landing marketing | L46 `<!-- SCREEN 1: LANDING -->` | `showScreen('landing')` |
| Pre-party (avant début) | L67 `<div id="pre-party-screen">` | `showPreParty()` |
| Consent RGPD | L108 `<div id="consent-screen">` | `setupConsent()` L1464 |
| MON PROFIL | L302 `<div id="profile-screen">` | `setupProfile()` L1502 |
| Code entry (rejoindre code) | L537 `<div id="code-screen">` | `setupCodeScreen()` L2138 |
| MES AMIS / MON CERCLE | L558 `<div id="my-friends-screen">` | `openMyFriendsScreen()` L4827 → `_renderMyFriends()` L4904 |
| MES UNIVERS | L582 `<div id="my-univers-screen">` | `openMyUniversScreen()` L4879 |
| COCKPIT (AGIR / ON AIR / MOI / AFTERGLOW) | L600 `<div id="cockpit-screen">` | `showTab(name)` + `renderX()` par tab |
| Tab SOUVENIRS (CP3) | L904 | `renderSouvenirs()` |
| Tab HUB social | L991 | `setupSocialHub()` L4517 |
| SOCIAL HUB | L1021 `<div id="hub-screen">` | idem |

### Composants dynamiques HTML-in-JS (édition possible mais brief obligatoire)

Ces morceaux sont générés par template literals dans `app.js`. Elles concentrent presque toutes les cartes/tiles visibles :

| Composant | Fonction | Ligne |
|---|---|---|
| Carte "RENCONTRÉ / CROISÉ DANS CE MOMENT" | `_renderMyFriends()` → `.cercle-person--recent` | L4961 |
| Carte "DEMANDE REÇUE" (pending) | idem | L4937 |
| Carte "DANS TON CREW" (friend) | idem | L4940 |
| Carte "INVITATION ENVOYÉE" (sent) | idem | L4948 |
| Cartes AGIR (bangers, tops) | `renderAgirBoostList()`, `renderV2Bangers()` | grep |
| Ça monte (suggestions live) | `renderCaMonte()` L4278 | |
| Trombinoscope | `renderTrombi()` L4585 / `renderCockpitTrombi()` L4621 | |
| Leaderboard | `renderLeaderboard()` L6681 | |
| Moi overview | `renderMoiOverview()` L6711 | |
| Missions | `renderMissions()` L6637 | |
| Mes tops / suggestions | `renderMyTops()` L7240 / `renderMySugs()` L7280 | |
| Costume contest | `renderCostumeEntries()` L5534 / `renderCostumePodium()` L5678 | |
| QR / Contact end | `showPartyQR()` L6247 / `showEndContactCard()` L6513 | |

### Styles (`style.css`)

Structure existante des sections (sentinelles `/* ─── ... ─── */`) :

- L6 : `CSS Custom Properties` — **⚠️ variables globales, PAS TOUCHER sans review**
- L53 : `Reset & Base`
- L65 : `Screen System` — logique showScreen
- L361 : `Profil guest`
- L1611 : `Costume Contest`
- L1732 : `Gallery Grid`
- L2533 : `UserChipView Styles`

**Beaucoup de sections ne sont PAS marquées** — c'est un legacy. Pour trouver le style d'un composant :

```
1. Grep la classe dans app.js pour trouver un exemple d'usage
2. Grep la classe dans style.css pour trouver sa règle
3. Rechercher `.cercle-` / `.profile-` / `.agir-` / `.v2-` / `.moi-` par préfixe
```

Les préfixes de classes CSS AhOuai actuels :
- `.profile-*` → écran MON PROFIL
- `.cercle-*` → écran MES AMIS / MON CERCLE  
- `.univers-*` → modal MES UNIVERS
- `.agir-*` / `.v2-*` → tab AGIR (cockpit)
- `.moi-*` → tab MOI
- `.afterglow-*` → tab AFTERGLOW
- `.souvenirs-*` → tab SOUVENIRS
- `.trombi-*` → trombinoscope

## 4. Cache-bust obligatoire à chaque édition CSS

Le lien CSS a une version query string ligne 42 de `index.html` :

```html
<link rel="stylesheet" href="style.css?v=20260923-profile-row">
```

**À chaque commit qui touche `style.css`**, bump cette version. Format libre mais recommandé : `YYYYMMDD-topic-court` (ex: `20260924-cercle-cards`). Sinon les guests voient l'ancienne CSS cachée par leur navigateur pendant 24-72h.

Idem pour `app.js` si tu vois un `?v=` dessus (grep pour vérifier).

## 5. Zones interdites (rouge absolu)

**Ne touche JAMAIS ces fichiers/zones sans brief explicite Jean-Sé.** Un push accidentel casse la production pour tout le monde.

- `server.js` (backend Node)
- `routes/` — endpoints REST
- `models/` — schémas Mongoose
- `middleware/authGuest.js` — logique auth Sprint B
- `services/` — logique business
- `utils/participantDedup.js` — règle dedup stricte
- `.env`, `.env.example`, `render.yaml`, `package.json`, `package-lock.json`

Dans `public/app.js`, ces zones aussi sont sensibles :
- **Toutes les fonctions `socket.on('guest:...')` et `socket.emit('guest:...')`** — logique temps réel
- **`saveSession()`, `saveProfile()`, `_friendsAuthHeaders()`, `persistProfileToUser()`** — pipeline auth/persist
- **`showScreen()`, `showTab()`** — routage
- **Anything auth-related** (Supabase, PKCE, session tokens)

Si Daphné brief un changement qui **implique** ces zones (ex: "ajoute un bouton qui envoie une demande d'ami"), tu :
1. Fais le CSS/HTML/copie côté visible
2. Laisse un `TODO(stan→jean-sé): wire socket handler for X` au bon endroit
3. Commit avec suffixe `(partial-needs-wiring)`
4. Envoie un message à Daphné → elle escalade à Jean-Sé

## 6. Workflow git standard (obligatoire à chaque session)

```bash
# 1. TOUJOURS commencer par pull
cd ~/AhOuai/socialmix-relay
git pull origin main

# 2. Vérifier que tu es sur main + clean
git status
# → doit dire "nothing to commit, working tree clean"

# 3. Faire les édits (Read → Edit → Write via tools Claude)

# 4. Vérifier la syntaxe avant commit
node --check public/app.js
# Si tu as édité CSS, bump index.html L42 style.css?v=...

# 5. Commit atomique (un changement = un commit)
git add public/app.js public/style.css public/index.html
git commit --no-verify -m "style(cercle): refonte carte RENCONTRÉ - Daphné brief 24/09"
# --no-verify car le pre-commit gitleaks est buggy en sandbox (voir SECURITE.md)

# 6. Push (Render déploie automatiquement)
git push origin main

# 7. Confirmer à Daphné :
# "Push OK - commit {shortsha}. Render rebuild en ~2min. Recharge join.ahouai.com?code=XXX pour tester."
```

### Si le push est refusé (rejected non-fast-forward)

Quelqu'un a push entre ton `git pull` et ton `git push`. Rebase :

```bash
git pull --rebase origin main
# résous les conflits si besoin (rare sur du CSS/HTML)
git push origin main
```

### Si tu casses la prod

Rollback instantané :

```bash
git revert HEAD --no-edit
git push origin main
```

Render redéploie l'état précédent en 2 min. Puis dis à Daphné + Jean-Sé ce qui s'est passé.

## 7. Règles de coordination multi-agents

On est plusieurs agents à pouvoir push sur ce repo (Jean-Sé's Claude, ChatGPT/Codex, Antigravity, toi). Pour éviter de se marcher dessus :

1. **`git pull` avant CHAQUE session** — non-négociable.
2. **Commits atomiques et petits** — un changement design cohérent par commit. Facilite le revert et la review.
3. **Messages de commit descriptifs en français** — `style(screen): que change et pourquoi`. Exemple : `style(profile): boutons horizontaux + retire corbeille externe`.
4. **Éviter les gros refactors CSS** — si tu dois toucher plus de 200 lignes de style.css d'un coup, split en plusieurs commits.
5. **Grep avant d'inventer une classe** — vérifie qu'elle n'existe pas déjà, réutilise plutôt que dupliquer.

## 8. Convention "brief Daphné → commit Stan"

Message-type que Daphné t'envoie :

> "Sur MON PROFIL, la carte hero est trop dense. Aère les paddings, agrandis la photo (60 → 80), enlève le sous-texte 'profil prêt pour le crew' qui fait doublon. Voici la mockup Figma : [screenshot]."

Réponse-type que tu envoies après push :

> "Push OK, commit `7ea4065`. Modifs :
> - `.profile-hero-top` gap 3 → 4, padding 16 → 20
> - Photo circle 60px → 80px, border 2px → 3px
> - Retiré `<span id="profile-completion">` de index.html L319
> - Cache CSS bumpé v20260924-hero-space
> 
> Render rebuild en 2min. Recharge et dis-moi."

Court, factuel, actionnable.

## 9. Testing sans casser la prod (recommandé mais optionnel)

Si Daphné veut expérimenter sans push direct sur main :

```bash
git checkout -b design/daphne-cercle-refonte
# ... édits ...
git push origin design/daphne-cercle-refonte
```

Puis créer une PR sur GitHub (l'app GitHub mobile permet à Jean-Sé de merger en 10 secondes depuis son iPhone).

Preview environment Render (à activer une fois par Jean-Sé) déploie chaque branche sur une URL unique `socialmix-relay-pr-XX.onrender.com`. Daphné teste là avant merge.

**Par défaut** pour V1 : push direct main pour changements CSS/HTML simples. PR pour tout ce qui touche app.js structure ou plus de 3 fichiers.

## 10. Contacts / escalade

- **Bug qui bloque la prod** → Daphné écrit à Jean-Sé sur WhatsApp
- **Question sur une convention** → Daphné demande à Jean-Sé
- **Doute sur "est-ce zone rouge"** → mieux vaut demander qu'assumer
- **Tu (Stan) hallucines une classe/fonction** → grep avant, si ça n'existe pas, dis-le à Daphné

## 11. Checklist avant chaque push

- [ ] `git pull origin main` fait
- [ ] `node --check public/app.js` OK si édition JS
- [ ] Cache-bust bumpé si édition CSS
- [ ] Aucun fichier zone-rouge touché
- [ ] Message de commit descriptif en français
- [ ] Confirmé à Daphné par message court après push

---

**Version doc** : 1.0 — 24 septembre 2026  
**Auteur** : Claude (Jean-Sé) pour Stan (Daphné)  
**Prochaine révision** : quand la migration Next.js écran-par-écran (task V1.1) démarre — ce doc deviendra obsolète progressivement.
