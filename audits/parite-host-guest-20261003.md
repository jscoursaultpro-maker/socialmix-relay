# AUDIT PARITÉ AhOuai — HOST + GUEST, iOS ↔ WEB — 3 octobre 2026

> **Mode : READ-ONLY STRICT.** Aucune modification, aucun commit, aucune PR sur les trois
> dépôts. Lecture seule : `Read`, `Grep`, `Glob`, `git log`, plus le connecteur Render en
> lecture.
>
> **Doctrine « facts only ».** Chaque `✅` / `❌` porte un `chemin:ligne`. Une donnée absente est
> notée `N/A` avec sa raison. Aucune feature n'est déduite d'un nom de fichier.
>
> **Doctrine 3.9.** Chaque absence a été élargie par grep avant conclusion : feature flag,
> `#if DEBUG`, `@available`, fichier au nom inattendu, call site réel.

---

## 📊 Résumé exécutif

**Parité HOST (A / B / Web) : 6/10.** **Parité GUEST (iOS / Web) : 7/10.**

Le protocole reposait sur trois prémisses, et **les trois sont fausses ou mal situées**. Les
corriger était plus utile que remplir les cases : sans ça, les deux matrices auraient comparé
les mauvaises surfaces. Détail en section suivante.

**3 écarts majeurs HOST**
1. **B n'a aucune modération** (photo, message) ni le concours de déguisement — et B est
   accessible en production, pas derrière `#if DEBUG`.
2. **Le host web n'a aucun contrôle d'hôte** sur le concours, la salle d'attente et la
   modération — mais les handlers serveur existent tous. C'est du non-branché, pas du manquant.
3. **Rechargement de page = perte du contrôle hôte** sur le web : `party` (code + `hostSecret`)
   vit en mémoire seule. `host:resumeParty` existe côté serveur et n'est pas utilisé.

**3 écarts majeurs GUEST**
1. **La cible `SocialMixGuest` est morte** — pas de `PBXNativeTarget`, trois de ses six fichiers
   absents du `.xcodeproj`. Le guest iOS réel est `GuestExperienceView`, dans l'app host.
2. **`ahouai-web` ne contient aucun socket** : pas de `socket.io-client` dans
   `package.json`. La participation en direct est entièrement dans l'app vanilla du relais.
3. **Aucun SOS Banger côté guest**, ni iOS ni web, ni même côté serveur — la feature est
   annoncée dans les instructions du projet mais n'existe nulle part.

**🚨 Un écart hors protocole, et il domine tout le reste : contournement d'authentification
`sbauth`** (P0). `middleware/authGuest.js:33-64` et `:80-106` acceptent un jeton **base64 non
signé** et résolvent l'utilisateur par `supabaseUserId`, puis **par email**. Connaître l'email
d'une personne suffit à être authentifié comme elle sur **42 routes**, dont la suppression de ses
photos et la modification de son profil. Détail et preuves en section « Sécurité ».

**Reco priorité — top 5**
1. `sbauth` : signer le jeton (HMAC) ou supprimer ce chemin. **Avant toute mise en avant du web.**
2. Brancher la modération host web (photo, message) — les handlers serveur sont prêts.
3. Décider du sort de `SocialMixGuest` : supprimer le dossier ou en faire une vraie cible.
4. `host:resumeParty` côté web, pour survivre à un rechargement en pleine soirée.
5. Trancher B : compléter la modération, ou masquer le basculeur A/B en production.

---

## 🧭 Corrections de prémisses

### 1. « Cockpit A ancien vs cockpit B nouveau » — vrai, mais pas là où le protocole le cherchait

Le protocole proposait de distinguer A et B via `CockpitView.swift` et `JukeboxDeckView.swift`.
**C'est faux :**

- `JukeboxDeckView.swift` ne définit **aucun** type `JukeboxDeckView`. Il définit
  `struct DeckView` (`SocialMixApp/Views/JukeboxDeckView.swift:7`).
- `DeckView` est instancié **une seule fois**, dans `CockpitView.swift:1562`, dans le `else` de
  `if djMode == .appMix` (`:1483`, `:1558`). C'est **une section du cockpit**, pas un écran
  concurrent.
- Seul `CockpitView` est atteint par la navigation (`AppNavigationView.swift:49`, `:96`, `:122`).

**Mais le A/B existe réellement, ailleurs :**

- `enum AhOuaiExperienceVersion { current = "A", future = "B" }` — `Views/HeaderView.swift:9-12`.
- Réglage : `@AppStorage("ahouai.experience.version")` — `CockpitView.swift:81`, défaut **A**.
- Bascule : `CockpitView.body` `:622-632` → **A** = `baseView` (cockpit historique) ·
  **B** = `FutureExperienceShell(role: .host, …)` (`HeaderView.swift:99`).
- Basculeur `ExperienceVersionSwitcher` (`HeaderView.swift:30`), affiché dans les deux headers
  (`:2296` et `:166`), **sans `#if DEBUG`** → visible en release, badge « BETA » (`:181`).
- B est un shell à 4 onglets AGIR / ON AIR / MOI / AFTERGLOW (`HeaderView.swift:2144-2150`).

**Couplage à connaître :** B n'est pas autonome. Quand B est actif, A reste monté en
`opacity 0`, hit-testing coupé (`CockpitView.swift:625-627`) ; la socket et les handlers de A
continuent de tourner (`:958`). Les boutons « MAINTENANT » / « SUIVANT » de B écrivent
`hostSocket.stagedFromSuggestion` (`HeaderView.swift:1033`), consommé **uniquement** par
`DeckView.onChange` (`JukeboxDeckView.swift:692-693`, `:809-811`) — qui n'est monté que si
`djMode != .appMix`. **En mode appMix, le staging de B n'a donc aucun consommateur.**

**N/A — « B inspiré du web » :** rien dans le code ne le prouve ni ne l'infirme. Le seul
commentaire parle d'« A/B preview » (`HeaderView.swift:7`).

### 2. Le guest iOS autonome n'existe pas

`SocialMixGuest/` **n'est pas une cible buildée.**

- Deux `PBXNativeTarget` seulement : `AhOuai` (`SocialMixApp.xcodeproj/project.pbxproj:607`) et
  `AhOuaiShareExtension` (`:632`). Un seul scheme : `AhOuai.xcscheme`.
- Compilés dans `AhOuai` : `GuestSocketClient.swift` (`:765`), `GuestSearchView.swift` (`:764`),
  `QRScannerView.swift` (`:838`).
- **Absents du pbxproj :** `SocialMixGuestApp.swift`, `Views/GuestViews.swift`,
  `Views/ConsentView.swift`.
- Le seul `@main` est `SocialMixAppApp.swift:87`. Celui de `SocialMixGuestApp.swift:3` n'est
  compilé nulle part.
- Une compilation autonome serait **impossible** : `GuestViews.swift` dépend de `SocialHubView`,
  `ProfileStore`, `AuthService`, `UserChipView`, `AppBackgroundGradient`, tous dans `SocialMixApp`.
- `QRScannerView` et `GuestSearchView` sont **compilés mais inatteignables** : leurs seuls
  appelants sont dans `GuestViews.swift` (`:226`, `:578`), non buildé.

**Le guest iOS réel est `SocialMixApp/Views/GuestExperienceView.swift`**, compilé
(`project.pbxproj:762`), atteint par `AppNavigationView.swift:52` (simulateur), `:88`
(`.guestJoin`), `:90` (`.guestJoinWithCode`). Plus une **troisième** surface : le même flag A/B
donne `FutureExperienceShell(role: .guest)` (`GuestExperienceView.swift:858`).

**Pièges relevés dans le code mort :** `GuestViews.swift:314-333` affiche des valeurs en dur
(« Alors On Danse », « Stromae », « Electro ») et `:51`/`:193` un code de repli `"TEUF2025"`.
`GuestViews.swift:58-61` appelle `SocialHubView` **sans** `isGuest: true` → branche host par
défaut (`SocialHubView.swift:7`). Rien de tout ça ne tourne, mais une régénération xcodegen le
rendrait vivant : `project.yml:16-19` prend le dossier entier et n'exclut que deux fichiers.

### 3. `ahouai-web` n'est pas le guest web en direct

`ahouai-web` porte **l'entonnoir d'arrivée, l'AfterGlow et les pages sociales**. Pas la soirée.

- **Aucun socket :** `socket.io-client` absent de `package.json`. Un seul match pour
  `socket|WebSocket` dans `src/`, un commentaire sans code (`join/[partyCode]/first-taste/page.tsx:18`).
- L'entonnoir sort **vers le relais** : `first-taste/FirstTasteClient.tsx:329` construit
  `https://join.ahouai.com/?code=<code>&sb=1&sbauth=<base64>` (`:350-352`), appelé en
  `window.location.replace` (`:364`, `:378`, `:749`). `pending/PendingClient.tsx:43-70` fait la
  même redirection après acceptation.
- Le relais reprend : `app.js:6679-6722` lit `sb=1` + `sbauth`, pose `state.userId`, écrit le
  cookie sur `.ahouai.com` (`:6712`), puis `enterCockpit()`. Socket ouvert à `app.js:2268`.
- Il n'existe **aucune route Next de soirée en direct**.

**Et le host web n'est pas `/host/`.** Le host web réel est la SPA invité en mode host :
`public/index.html` + `public/app.js` + `host-mode.js` / `host-engine.js` / `host-cockpit.js`.
L'ancien `/host/` est du code mort : `public/host/host.js:894-897` redirige vers
`/?sb=1&hostlaunch=1` et le flux d'origine en dessous n'est jamais atteint.

---

## 🖥️ MATRICE HOST

**A** = `CockpitView` + `DeckView` · **B** = `FutureExperienceShell(role:.host)` ·
**Web** = SPA en mode host. Pour le web, **H** = contrôle d'hôte (`host:*`),
**P** = participation héritée (`guest:*`), **L** = local sans émission.

| Feature | iOS A | iOS B | Web host | Écart | Note |
|---|---|---|---|---|---|
| Login Supabase | ✅ `AuthService.swift:124` | ✅ idem | ✅ L `app.js:655-727` | — | Gate release : `SocialMixAppApp.swift:100-106` |
| Sign in with Apple / Google | ✅ `LoginView.swift:105`, `:125` | ✅ idem | ✅ `app.js:730-756` | — | |
| Logout | ✅ `ProfileHubView.swift:124` | ✅ `HeaderView.swift:160` | ✅ `app.js:1729-1764` | — | |
| Switch user | ❌ N/A | ❌ N/A | ❌ N/A | — | Aucun sélecteur de compte nulle part |
| Créer une soirée | ✅ `ReadyScreen.swift:609-625` | ✅ (via A) | ✅ H `host-engine.js:311` | ⚠️ | Payload web sans `partyName`/`visibility`/`isJustPlay` |
| Choix provider Spotify / Apple | ✅ `ProviderSetupScreen.swift:283-331` | ✅ (via A) | ✅ `host-engine.js:114-158` | — | |
| Provider Deezer | ⚠️ bloqué V1 `:286-291` | ⚠️ idem | ❌ N/A | — | iOS ouvre une feuille de vote |
| Provider YouTube | ❌ N/A (0 occurrence) | ❌ N/A | ✅ `youtube-engine.js:59` | **P1** | Web seul |
| Just Play | ✅ `HomeView.swift:110-119` | ✅ (via A) | ⚠️ `app.js:6936` | **P2** | Web : `mode=justplay` jamais relu |
| Playlist seed | ❌ N/A | ❌ N/A | ❌ N/A | — | File via `/api/djbrain/next` |
| Config des phases (setup) | ⚠️ `PhaseTimelineView.swift:12-40` | ⚠️ `HeaderView.swift:792-875` | ❌ N/A | **P2** | Seuils en dur `DJBrain.swift:245-251` |
| On Air / lecteur | ✅ 3 modes `JukeboxDeckView.swift:1060`, `:877`, `CockpitView.swift:1484` | ✅ 1 mode `HeaderView.swift:666` | ✅ `index.html:752-835` | **P1** | B et Web : pas d'appMix ni DJ Live |
| Play / pause | ✅ `JukeboxDeckView.swift:1446` | ✅ `HeaderView.swift:693` | ✅ `host-mode.js:73-76` | ⚠️ | Web : icône désynchronisée si pause moteur (`host-engine.js:129`) |
| Skip | ✅ `JukeboxDeckView.swift:1507` | ✅ `HeaderView.swift:730` | ✅ H `host-engine.js:463-468` | — | |
| Seek | ❌ N/A `:1240-1245` lecture seule | ❌ N/A | ❌ N/A `player-engine.js:6-30` | — | Absent des 3 surfaces |
| Volume | ⚠️ définis jamais instanciés `:3288`, `:3980` | ❌ N/A | ❌ N/A `spotify-service.js:111` | **P2** | Fixé à 0.8 sur le web |
| Suggestions en attente | ✅ `SuggestionsSheetView.swift:11` | ✅ `HeaderView.swift:899` | ⚠️ `host-cockpit.js:183-212` | **P1** | Web : visible **seulement si auto OFF**, plafond 10 |
| Historique titres joués | ✅ `JukeboxDeckView.swift:2868` | ⚠️ 5 titres `HeaderView.swift:1787` | ⚠️ `#history-list` masqué `index.html:1058` | **P1** | Web : seul « top 6 par score », pas chronologique |
| Current track « suggéré par X » | ✅ `JukeboxDeckView.swift:1133` | ❌ N/A sur On Air | ✅ `app.js:3190-3200` | **P2** | B : seulement dans l'onglet AFTERGLOW (`:1772`) |
| Compteur participants | ✅ `CockpitView.swift:1499` | ✅ `HeaderView.swift:1841` | ⚠️ `host-cockpit.js:286-287` | **P2** | Web compte l'hôte (pas de filtre `isHost`) |
| Suggérer (recherche) | ✅ `JukeboxDeckView.swift:1801` | ✅ `HeaderView.swift:1380` | ✅ P `app.js:3662` | ⚠️ | B cherche **toujours** via Deezer (`:1483`), quel que soit le provider |
| Suggérer via lien collé | ❌ N/A (Share Ext seulement) | ✅ `HeaderView.swift:1501` | ✅ P `app.js:3493-3516` | **P2** | A n'a pas de collage |
| Vote feu / cool / bof | ✅ `JukeboxDeckView.swift:262` | ✅ `HeaderView.swift:677` | ✅ P `app.js:3277` | ⚠️ | B envoie `"fire"`, A `"feu"` (client tolère, serveur non audité) |
| Boost suggestions | ✅ `:2276` | ✅ `HeaderView.swift:1207` | ✅ P REST `app.js:4242` | ⚠️ | iOS : 429 avalé sans retour (`HostSocketClient.swift:1066` TODO) |
| Galerie photos | ✅ `SocialHubView.swift:292-303` | ⚠️ 6 max, lecture seule `:1803` | ⚠️ 6 max, sans lightbox `app.js:8853` | **P1** | |
| Messages | ✅ `SocialHubView.swift:324-441` | ⚠️ 4 derniers `:1824` | ⚠️ 4 derniers `app.js:8878` | **P2** | |
| Concours déguisement | ✅ `SocialHubView.swift:735-800` | ❌ N/A | ⚠️ P seulement | **P1** | Voir « contrôle hôte » ci-dessous |
| Liste participants | ✅ `ParticipantsView.swift` | ✅ `HeaderView.swift:1841` | ⚠️ `app.js:4769` | **P2** | Web : pas de vue hôte dédiée |
| Terminer la soirée | ✅ `CockpitView.swift:1423` | ✅ (délègue à A) `:630` | ✅ H `host-cockpit.js:106-126` | — | |
| Modération photo | ✅ `SocialHubView.swift:1240` | ❌ N/A | ⚠️ voie REST sans UI | **P1** | Voir détail |
| Modération message | ✅ `SocialHubView.swift:395` | ❌ N/A | ❌ N/A | **P1** | Handler serveur `server.js:8088` prêt |
| Modération suggestion | ✅ `:2367` | ✅ `HeaderView.swift:1005` | ✅ H `host-engine.js:510-513` | — | Web : titre DJ Brain → suppression locale seule |
| Blocage d'un invité | ❌ N/A | ❌ N/A | ❌ N/A | — | Aucun handler serveur non plus |
| Éjection d'un invité | ⚠️ local sans emit `ParticipantsView.swift:113-120` | ❌ N/A | ❌ N/A | **P2** | Le « x » ne retire que du tableau local |
| Transition de phase manuelle | ✅ `PhaseTimelineView.swift` | ✅ `HeaderView.swift:845-852` | ✅ H `host-cockpit.js:128-138` | — | Les 3 surfaces l'ont |
| Salle d'attente / approbation | ❌ N/A | ❌ N/A | ❌ N/A | **P1** | 6 handlers serveur prêts, voir détail |
| AfterGlow timeline | ✅ `PartyEndedScreen.swift:302` | ⚠️ 5 titres `:1782` | ⚠️ par score `app.js:8814` | **P2** | |
| Top boosters / suggesters | ❌ N/A | ❌ N/A | ❌ N/A | **P2** | Absent des 3 surfaces |
| AfterGlow galerie | ✅ `PartyEndedScreen.swift:408` | ⚠️ `:1803` | ⚠️ `app.js:8853` | — | |
| Messages archivés | ✅ `PartyEndedScreen.swift:522` | ⚠️ `:1824` | ⚠️ `app.js:8878` | — | |
| Partage du lien AfterGlow | ❌ N/A | ❌ N/A | ⚠️ `shareSouvenirs` sans appelant `app.js:9076` | **P1** | Aucune URL AfterGlow construite côté iOS |
| Push distant | ❌ N/A | ❌ N/A | ❌ N/A | **P2** | `aps-environment: development` ; TODO APNS `routes/party-join.js:73` |
| Notifications locales | ✅ `DeezerService.swift:574` | ✅ (via A) | ❌ N/A | **P2** | |
| Toasts in-app | ✅ `CockpitView.swift:406` | ✅ `HeaderView.swift:1036` | ✅ `app.js:134` | ⚠️ | Web : aucun toast à l'arrivée d'une suggestion (`host-engine.js:537-547` logge seulement) |
| Profil / photo | ✅ `ProfileHubView.swift:296-330` | ✅ `HeaderView.swift:159` | ✅ `app.js:1996` | — | |
| Préférences audio | ❌ N/A | ❌ N/A | ❌ N/A | — | |
| Mentions légales | ✅ `ProfileHubView.swift:113-119` | ✅ (via A) | ⚠️ onboarding seul `index.html:179` | **P2** | Web : absentes du profil |
| Menu debug | ⚠️ inatteignable | ⚠️ idem | ⚠️ `?hostdebug=1` logs seuls | **P2** | Voir détail |

### Écarts détaillés HOST

**[P1] B sans modération ni concours — et visible en production**
Direction : porter de A vers B. Effort : M. Dépendances : front seul.
B n'a ni modération photo (`SocialHubView.swift:1240` absent de B), ni modération message
(`:395`), ni concours (0 occurrence de « costume » dans `HeaderView.swift`), ni éjection. Le
basculeur A/B n'est **pas** sous `#if DEBUG` (`HeaderView.swift:2296`, `:166`) : un hôte peut
basculer en B en production et perdre ces outils. Le commentaire du dev le dit lui-même
(`HeaderView.swift:2266-2273`) : « Les outils de traitement et de modération viendront
compléter cet espace ».
→ **Décision produit requise** : compléter B, ou masquer le basculeur en release.

**[P1] Host web : trois contrôles d'hôte non branchés, handlers serveur prêts**
Direction : porter du serveur vers le host web. Effort : S par contrôle. Dépendances : front seul.

| Contrôle | Web host | Handler serveur existant |
|---|---|---|
| Concours (ouvrir/fermer/podium) | ❌ aucun `host:closeCostume` émis | `server.js:7982`, `:5984`, `:5999`, `:7973` |
| Salle d'attente | ❌ aucun listener/émit | `server.js:6309`, `:6460`, `:6480`, `:6536`, `:6573`, `:6610` + REST `routes/party-join.js:29,84,106,157` |
| Modération message | ❌ aucun `host:deleteMessage` | `server.js:8088` |
| Modération photo | ⚠️ voie REST sans UI | `server.js:8078` + `routes/party-photos.js:30-82` |

Nuance sur la photo, qui **infirme partiellement** l'audit antérieur : `routes/party-photos.js:52-53`
autorise déjà le propriétaire **ou l'hôte** à supprimer, et la SPA affiche « 🗑️ Supprimer » si
`meta.canDelete` (`app.js:5883-5900`). Mais la lightbox n'est joignable pour les photos d'autrui
que via les vignettes du concours (`app.js:5790`, `:6001`), donc via `#hub-screen` — absent des
4 onglets. **La capacité existe, l'UI de modération n'existe pas.**

**[P1] Rechargement de page = perte du contrôle hôte (web)**
Direction : harmoniser. Effort : S. Dépendances : front seul (le serveur est prêt).
`party` (code + `hostSecret`) vit en mémoire seule (`host-engine.js:23`, aucun storage). Après
reload, `isHostMode()` peut rester vrai via `participants.isHost` (`host-mode.js:21-26`) mais le
moteur est inactif (« Lance une soirée pour piloter », `host-mode.js:75`). `host:resumeParty`
existe (`server.js:4867`) et n'est **pas** utilisé. En pleine soirée, un rafraîchissement
accidentel coûte la main.

**[P1] Garde anti-rejeu Z11 : refus silencieux côté web**
Direction : harmoniser. Effort : XS. Dépendances : front seul.
Le serveur refuse un titre déjà joué sans `confirmReplay` et émet `z11:replayDetected`
(`server.js:5400-5425`). Le web n'a ni listener ni `confirmReplay` (grep `public/` : 0) : le
titre ne part pas et l'hôte n'en sait rien.

**[P1] Spotify sans device : message d'erreur trompeur (web)**
Direction : harmoniser. Effort : XS.
`host-engine.js` n'écoute pas `noDevice` (listeners `:127-145`). Le seul retour est
`toast('Impossible de trouver un titre jouable')` (`:271`) — qui désigne le catalogue alors que
le problème est le device. Le sélecteur de device n'existe que dans l'ancien `/host/`
(`host/index.html:207`), code mort.

**[P1] Historique et « À suivre » : trois comportements différents**
Direction : harmoniser. Effort : S.
A affiche l'historique complet, B les 5 derniers, le web masque `#history-list`
(`index.html:1058`) et n'offre qu'un top 6 **par score** (`app.js:8814-8840`). Par ailleurs
`host:nextTrack` (`server.js:6061`) n'est **jamais** émis par le web : la barre
`next-track-bar` (`index.html:840`) reste vide pour les invités.

**[P2] YouTube : web seul**
Direction : décision produit. `grep -ri youtube` sur `*.swift`, `*.plist`, `*.yml`, `*.md` → 0.
Le provider n'existe pas côté iOS, alors que `youtube-engine.js:59` le sert sur le web.

**[P2] Double réception chez l'hôte web**
L'hôte est dans `host:CODE` **et** `guest:CODE`, et le serveur émet `track:update` dans les deux
(`server.js:5694`, `:5697`) → `setupVoteButtons` rappelé deux fois (`app.js:2788-2795`).

**[P2] Menu debug inatteignable (iOS)**
`DebugSettingsView` est sous `#if DEBUG` (`Views/DebugSettingsView.swift:8`), son `.sheet` aussi
(`CockpitView.swift:757-758`), mais `showDebugSettings` (`:83`) n'est mis à `true` **nulle part**.
La vue est inatteignable même en DEBUG. À l'inverse, `DevMenuView` est accessible depuis
`ProfileHubView.swift:138-139` **sans** `#if DEBUG` → visible en release.

---

## 📱 MATRICE GUEST

**GEV** = `SocialMixApp/Views/GuestExperienceView.swift` (surface A, la vivante) ·
**B** = `FutureExperienceShell(role:.guest)` · **Web** = relais `public/app.js` (le direct) ·
**Next** = `ahouai-web` (entonnoir + AfterGlow). `SocialMixGuest/` est exclue des colonnes :
elle n'est pas buildée (voir corrections de prémisses).

| Feature | iOS GEV | iOS B | Web (relais) | Next | Écart | Note |
|---|---|---|---|---|---|---|
| Scan QR | ❌ N/A | ❌ N/A | ❌ N/A (affichage QR seul `app.js:6557`) | ❌ N/A | **P2** | Le scan passe par l'appareil photo natif puis le deep link |
| Saisie manuelle du code | ✅ `:478`, `:494` | ✅ | ✅ `index.html:595-612` | ❌ code dans l'URL | — | |
| Join via lien | ✅ `:101-105` ← `SocialMixAppApp.swift:237-330` | ✅ | ✅ `app.js:6670` | ✅ `join/[partyCode]/page.tsx:14` | — | `server.js:504` route vers Next sauf `sb=1` |
| Login Supabase | ⚠️ en amont, gate app `SocialMixAppApp.swift:100-107` | ⚠️ idem | ✅ `app.js:655`, `:730-745` | ✅ `AuthClient.tsx:31` | — | |
| Invité anonyme (prénom + emoji) | ⚠️ prénom seul `:477` | ⚠️ | ✅ emoji-grid `index.html:467` | ❌ prénom seul `NameClient.tsx:34` | **P1** | **Bug : l'emoji du profil n'est jamais transmis** — `GuestExperienceView.swift:46` appelle `connect(partyCode:guestName:)` sans emoji → défaut `"🎉"` (`GuestSocketClient.swift:92`) |
| Consentement / CGU | ⚠️ en amont `WelcomeScreen.swift:55-72` | ⚠️ | ✅ `index.html:162-190` | ✅ `AuthClient.tsx:81` | ⚠️ | Next : liens `/cgu` et `/privacy` **sans route** dans `src/app` |
| Salle d'attente (pending) | ❌ N/A | ❌ N/A | ✅ `app.js:1411-1433` | ✅ polling 15 s `PendingClient.tsx:43-70` | **P2** | Deux implémentations parallèles |
| Suggérer (recherche) | ✅ `:1359-1470` | ✅ `HeaderView.swift:1380` | ✅ `app.js:3994-4007` | ⚠️ pré-live, 1 fois `FirstTasteClient.tsx:427` | — | GEV dédoublonne `already_played`/`already_suggested` (`:1429-1437`) |
| Suggérer via lien collé | ❌ N/A en UI | ✅ `HeaderView.swift:1501-1567` | ✅ `app.js:3492-3600` (Deezer/Apple/Spotify) | ❌ N/A | **P1** | **Le texte de GEV `:1070` promet « colle un lien » alors que l'UI n'existe pas en A** |
| Vote feu / cool / bof | ✅ `:721-732` → `GuestSocketClient.swift:135` | ✅ `HeaderView.swift:533` | ✅ `app.js:3298` | ❌ N/A | ⚠️ | B envoie `"fire"`, A `"feu"` ; client tolère les deux (`GuestSocketClient.swift:668-669`), **serveur non audité** |
| Boost de suggestion | ✅ `:1473-1562` | ✅ `HeaderView.swift:1207` | ✅ REST `app.js:4242` | ✅ REST `FirstTasteClient.tsx:223-246` | — | |
| Filtre « Mes Bangers » | ⚠️ pas de filtre, listes `:1716-1807` | ✅ `HeaderView.swift:1428` | ⚠️ onglet source `app.js:8067` | ⚠️ favoris `FirstTasteClient.tsx:687` | **P2** | Le libellé exact n'existe qu'en B |
| Upload photo | ✅ via `SocialHubView.swift:495-499` | ✅ `HeaderView.swift:1295` | ✅ `app.js:6219` (cap 6 `:5743`) | ❌ N/A | — | |
| Messages / chat | ✅ `SocialHubView.swift:321-326` | ✅ `HeaderView.swift:1299` | ✅ `app.js:4688-4700` | ❌ N/A | — | `reactionsSection` de GEV (`:1605-1637`) est du **code mort** |
| Vote genre / tendance | ✅ `:747-754` (debounce 2 s `:798-808`) | ✅ `HeaderView.swift:1347` | ✅ `app.js:3353` | ❌ N/A | — | |
| SOS Banger | ❌ N/A | ❌ N/A | ❌ N/A | ❌ N/A | **P1** | **Absent partout, serveur inclus.** `SOSBangerView` n'est utilisée que par le cockpit host (`CockpitView.swift:1534`) |
| Concours déguisement | ✅ `SocialHubView.swift:737-760` | ❌ N/A | ✅ `app.js:5672-5811` | ❌ N/A | **P1** | Absent de la surface B |
| Titre en cours | ✅ `:663-676` + badge `:680-716` | ✅ `HeaderView.swift:515` | ✅ `app.js:3189` | ❌ N/A | — | |
| Historique des titres | ⚠️ `:1810-1850` | ⚠️ `:1782` | ⚠️ masqué, temps forts `app.js:8819` | ✅ AfterGlow `TrackCard.tsx:88` | **P1** | **GEV : compteurs figés à 0** (`:603-605`) → labels BANGER/FLOP (`:2042-2076`) jamais affichés |
| Liste participants | ⚠️ compteur `:656`, liste via SocialHub `:510-592` | ✅ `HeaderView.swift:1841` | ✅ `app.js:4760` | ⚠️ aperçu `JoinClient.tsx:105` | **P2** | |
| Classement / scores | ✅ top 5 `:1565-1602` | ⚠️ points seuls `HeaderView.swift:2115` | ✅ `app.js:7162` | ⚠️ MVP seul `TopHighlights.tsx:28-43` | **P2** | |
| Galerie photos | ✅ `SocialHubView.swift:205-320` | ⚠️ `:1803` | ⚠️ 6 max `app.js:8845` | ✅ `PhotoTile.tsx:40` | **P2** | |
| Accès AfterGlow | ✅ `:121-125` → `GuestPartyRecapView.swift:6` | ✅ onglet `HeaderView.swift:1661` | ✅ `app.js:8723` | ✅ `soiree/[base62]/page.tsx:100-155` | ⚠️ | `onSelectParty` est un **no-op** (`:179`) |
| Top boosters / suggesters | ❌ N/A | ❌ N/A | ⚠️ « empreinte » perso `app.js:8904` | ❌ N/A | **P2** | Aucun classement global nulle part |
| Partage du lien AfterGlow | ❌ N/A | ❌ N/A | ⚠️ partage `/?code=` (lien de join) `app.js:9077` | ❌ image OG seule | **P1** | Aucune surface ne partage une URL `/soiree/` |
| Reconnexion automatique | ✅ `:133-155` + `GuestSocketClient.swift:103-110` | ✅ | ✅ `app.js:2268-2324`, session 6 h `:360-378` | ❌ N/A (pas de socket) | — | |
| Toasts | ✅ `:127-131`, `:189-221` | ✅ | ✅ `app.js:134`, `:201` | ❌ `alert()` dans l'entonnoir | **P2** | |
| Push | ❌ N/A | ❌ N/A | ❌ N/A | ❌ N/A | **P2** | Ni service worker, ni manifest, ni PushManager |
| Profil / photo | ✅ `ProfileHubView.swift:309-320` | ✅ `HeaderView.swift:159` | ✅ `app.js:1897-2048` | ⚠️ PATCH prénom seul | **P2** | |
| Mentions légales | ✅ `ProfileHubView.swift:114-119` | ✅ | ⚠️ `server.js:700-701` | ⚠️ liens sans route | **P2** | |

### Écarts détaillés GUEST

**[P1] Promesse d'UI non tenue dans GEV**
Direction : porter de B vers A, ou corriger le texte. Effort : XS (texte) / S (UI).
`GuestExperienceView.swift:1070` dit à l'invité de « coller un lien Deezer/Spotify/Apple Music ».
Aucun `UIPasteboard` dans GEV. La feature existe en B (`HeaderView.swift:1501-1567`) et sur le
web (`app.js:3492-3600`). L'invité iOS en surface A lit une consigne qu'il ne peut pas suivre.

**[P1] Emoji de profil jamais transmis**
Direction : corriger. Effort : XS. Dépendances : front seul.
`GuestExperienceView.swift:46` appelle `connect(partyCode:guestName:)` sans emoji → défaut
`"🎉"` (`GuestSocketClient.swift:92`). Aucun `guestEmoji =` ailleurs dans le repo. L'emoji choisi
dans `ProfileCreationView.swift:21` est donc perdu. Le web, lui, l'envoie (`index.html:467`).

**[P1] Compteurs de votes figés à zéro dans l'historique GEV**
Direction : corriger. Effort : XS.
`GuestExperienceView.swift:603-605` force `fireCount`/`likeCount`/`mehCount` à 0. Les labels
BANGER/FLOP (`:2042-2076`) ne peuvent donc jamais s'afficher. C'est une valeur par défaut
silencieuse là où la doctrine « honnêteté data » demande de masquer ou signaler l'absence.

**[P1] SOS Banger n'existe pas**
Direction : décision produit. Effort : M.
Annoncé dans les instructions du projet comme implémenté (« SOS Banger : guest demande un tube
d'urgence »). Grep en mot entier sur `app.js`, `index.html`, `server.js`, `routes/`, et sur les
vues guest iOS : **zéro**. Seul `SOSBangerView` existe, utilisée par le cockpit host
(`CockpitView.swift:1534`). Rien côté invité, rien côté serveur.

**[P1] Aucune surface ne partage une URL AfterGlow**
Direction : porter. Effort : S.
`ahouai-web` sert `/soiree/[base62]` et génère son image OG, mais aucun bouton de partage. Le
relais a `window.shareSouvenirs` (`app.js:9076-9093`) — **sans aucun appelant** (grep : 0) — et
il partagerait `/?code=` (un lien de join) et non une URL `/soiree/`. iOS ne construit aucune URL
AfterGlow. La page publique existe donc et personne ne peut la diffuser depuis l'app.

**[P2] `ahouai-web` : liens légaux morts**
`JoinClient.tsx:129` et `AuthClient.tsx:86` pointent `/cgu` et `/privacy` ;
`AhouaiFooter.tsx:21-27` pointe `ahouai.com/legal` et `/about`. Aucun dossier `cgu`, `privacy`
ou `legal` dans `src/app`, et pas de rewrite dans `vercel.json`. Sur un parcours qui exige
l'acceptation des CGU, c'est un point à traiter avant toute revue juridique.

**[P2] Placeholders App Store**
`join/[partyCode]/welcome/WelcomeClient.tsx:17` : `id6470000000` avec le commentaire
« Replace with real AhOuai App Store ID ». `components/afterglow/CTAFooter.tsx:32` :
`id0`. La route `welcome` n'est par ailleurs **pas branchée** (`welcome/page.tsx:1` :
« Not routed in V1 »).

---

## 🔐 Sécurité — hors protocole, mais prioritaire sur tout le reste

### [P0] Contournement d'authentification via `sbauth`

**Fait, vérifié ligne à ligne.** `middleware/authGuest.js` accepte deux formes de jeton
`sbauth` :
- en-tête `X-Auth-Type: sbauth` + `Authorization: Bearer <token>` — `:33-64`
- cookie `sbauth` — `:80-106`

Dans les deux cas, le jeton est **décodé en base64 puis parsé en JSON. Il n'est ni signé, ni
vérifié** : aucun HMAC, aucun secret, aucune validation Supabase sur ce chemin.

```js
const payloadStr = Buffer.from(decodeURIComponent(sbauthToken), 'base64').toString('utf8');
const payload = JSON.parse(payloadStr);
if (payload && payload.userId) {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(payload.userId);
  if (!isObjectId) {
    user = await User.findOne({ supabaseUserId: payload.userId });
    if (!user && payload.email) {
      user = await User.findOne({ email: payload.email });   // ← suffit
    }
  } else {
    user = await User.findById(payload.userId);
  }
  if (user && !user.isDeleted && !user.isBanned) { req.user = user; return next(); }
}
```

**Le repli par email (`:47-49` et `:91-93`) est le point critique.** Il suffit d'un
`userId` quelconque non-ObjectId et de l'email de la cible : `{"userId":"x","email":"<cible>"}`
encodé en base64. Un email n'est pas un secret.

**Portée : 42 usages de `verifyGuestAuth`** dans `routes/`, dont :

| Route | Ce que le contournement permet |
|---|---|
| `routes/user-profile-update.js` (3) | modifier le profil d'autrui |
| `routes/party-photos.js` (4) | **supprimer les photos d'autrui** |
| `routes/user-friends.js` (4) | gérer ses relations |
| `routes/party-merge.js` (3) | fusionner ses soirées |
| `routes/party-reopen.js` (2) | réouvrir ses soirées |
| `routes/me-tracks-favorites.js` (4), `me-suggestions-history.js` (3) | lire son historique |

**Chemin d'exposition.** Ce jeton circule **en clair dans une URL** :
`FirstTasteClient.tsx:350-352` construit `…&sbauth=<base64>` et
`app.js:6679-6722` le lit puis le repose en cookie sur `.ahouai.com` (`:6712`). Il transite donc
par l'historique de navigation, les `Referer` et les logs.

**Ce que je n'affirme pas.** Je n'ai pas testé de requête forgée contre la production — l'audit
est en lecture seule. La conclusion vient de la lecture du middleware, pas d'une exploitation.

→ **Décision à prendre, pas un correctif à improviser.** Deux options à arbitrer : signer le
payload (HMAC avec un secret serveur, vérification avant tout lookup), ou supprimer ce chemin et
n'accepter que l'`access_token` Supabase. La seconde est plus propre ; la première préserve le
parcours `sb=1` existant. Dans les deux cas, le repli par email devrait disparaître.

### [P1] `AUTO_APPROVE_GUESTS` : défaut `true`, valeur de production non vérifiable

`server.js:6396` : `(process.env.AUTO_APPROVE_GUESTS || 'true') === 'true'`. Le commentaire
`:6392-6395` dit « À DÉSACTIVER après livraison Étape 3 iOS ». La variable n'est ni dans
`render.yaml` (qui ne porte que `NODE_ENV`) ni dans `.env.example`.

**N/A — valeur en production : non vérifiable depuis cette session.** Le connecteur Render
expose la configuration du service (plan `starter`, région `frankfurt`, `autoDeploy: yes`,
1 instance) mais **pas les variables d'environnement en lecture**. Le défaut du code étant
`true`, l'approbation automatique est active sauf si la variable a été posée explicitement dans
le tableau de bord Render — à vérifier à la main.

Conséquence si elle passait à autre chose que `true` : les invités resteraient bloqués en
`pending` (`index.html:280`) **sans aucun moyen d'approbation depuis le host web** (voir
matrice HOST).

---

## 🎭 Features assumées non portées

- **Concours de déguisement** — A iOS et participation web seulement. Décision Jean-Sé : OK.
  Mais le **contrôle d'hôte** (fermer, podium) n'existe sur aucune surface alors que
  `server.js:7982` est prêt : la soirée ne peut pas clore un concours.
- **DJ Live (Shazam)** — non porté sur le host web. Décision Jean-Sé 03/10 : OK. Confirmé :
  B iOS ne l'a pas non plus, seul A l'a (`JukeboxDeckView.swift:877`).
- **Deezer** — bloqué en V1 côté iOS (`ProviderSetupScreen.swift:286-291`, feuille de vote),
  absent du web. Cohérent avec la décision du 14/09.
- **`SocialMixGuest/`** — non buildé. À confirmer comme abandonné : si oui, le supprimer, car
  `project.yml:16-19` prend le dossier entier et une régénération xcodegen le réactiverait
  partiellement.

---

## 📎 Annexes

### A. Provenance des constats — et ce que j'ai vérifié moi-même

Par souci d'honnêteté sur la méthode : l'inventaire par surface a été produit par quatre
explorations déléguées en lecture seule, chacune rendant des `chemin:ligne`. Je n'ai **pas**
revérifié personnellement chaque cellule des deux matrices.

J'ai vérifié moi-même, ligne à ligne :
- la cartographie des 3 dépôts (cibles Xcode, routes Next, arborescence Swift) ;
- l'absence de `_sdkDeviceId` dans `spotify-engine.js` (hors périmètre, demande antérieure) ;
- **tout le bloc `sbauth`** : lecture complète de `middleware/authGuest.js:18-132` et comptage
  des 42 `verifyGuestAuth` ;
- le défaut de `AUTO_APPROVE_GUESTS` (`server.js:6396`) et la configuration Render.

Les cellules non revérifiées restent des constats de lecture avec leur `chemin:ligne` : elles
sont contrôlables en une commande. Si une décision coûteuse devait reposer sur l'une d'elles, il
faut la revérifier avant.

### B. Dépôts et branches à la date de l'audit

| Dépôt | Branche | HEAD | Note |
|---|---|---|---|
| `socialmix-relay` | `main` | `4725a2c` | clone complet |
| `socialmix-ios` | `design-refresh-2026-may` | `4c9ce9d` | **clone shallow** (1 commit) |
| `ahouai-web` | `main` | `4877769` | **clone shallow** |

**Limite de méthode à connaître :** les clones iOS et web étant *shallow*, `git blame` et
`git log` par fichier sont inexploitables — impossible de dater l'arrivée de B, ni de savoir
quelle PR a ajouté ou retiré une feature (étape 4 du protocole, partiellement **N/A**). Un
`git fetch --depth=1000 origin <branche>` lèverait la limite.

### C. Commandes et greps utilisés

```bash
# Cibles Xcode réelles (preuve que SocialMixGuest n'est pas buildé)
grep -c "PBXNativeTarget" SocialMixApp.xcodeproj/project.pbxproj
grep -n "SocialMixGuestApp\|GuestViews\|ConsentView" SocialMixApp.xcodeproj/project.pbxproj

# Flag A/B
grep -rn "AhOuaiExperienceVersion\|ahouai.experience.version" --include=*.swift .

# Absence de socket dans ahouai-web
grep -rnE "socket|WebSocket" src/ ; grep -n "socket.io" package.json

# sbauth
grep -rn "sbauth" server.js routes/*.js middleware/*.js
grep -rn "verifyGuestAuth" --include=*.js routes/ server.js | wc -l

# Anti-faux-positif (doctrine 3.9)
grep -rn "#if DEBUG\|@available\|#available" --include=*.swift SocialMixApp/ SocialMixGuest/
grep -rnw "sos" public/app.js public/index.html server.js routes/
grep -rn "TODO\|FIXME\|HACK\|XXX" <fichiers concernés>
```

### D. TODO / FIXME / marqueurs relevés

| Chemin:ligne | Contenu |
|---|---|
| `SocialMixApp/Views/HomeView.swift:289` | `TODO: Chantier E — propagate firstTrackHint to HostSocketClient.startParty()` |
| `SocialMixApp/Engine/HostSocketClient.swift:1066` | `TODO: handle UI toast if needed` — 429 de boost avalé |
| `SocialMixApp/Engine/SpotifyService.swift:1493` | `TODO: Register at getsongbpm.com/api` (clé vide) |
| `SocialMixApp/Views/GuestExperienceView.swift:1715`, `:1748`, `:1809` | `TODO(V7.2): factoriser … CockpitView.swift ligne 2653 / 2686 / 2830` — **ces lignes n'existent plus** (le fichier fait 2273 lignes) |
| `relay-server/server.js:6392-6395` | AUTO_APPROVE à retirer après l'Étape 3 iOS |
| `relay-server/routes/party-join.js:73` | `TODO: send APNS push notification when configured` |
| `relay-server/server.js:460-464` | TODO Universal Links AASA, alors que `public/.well-known/apple-app-site-association` existe |
| `relay-server/public/shared/ui/host-engine.js:9` | En-tête périmé (« Spotify/Apple = brique suivante ») |
| `ahouai-web/src/components/profile/CrewsSection.tsx:113` | `// HACK for V1` — confusion UUID / MongoID |
| `ahouai-web/src/app/join/[partyCode]/welcome/page.tsx:1` | « V1.1 — Not routed in V1 » |

### E. Code mort et orphelins (à trier)

- `SocialMixApp/SocialMixAppApp_old.swift` : second `@main`. Absent du `.xcodeproj` mais
  `project.yml` prend le dossier entier → réactivable par xcodegen.
- `SocialMixApp/Views/Settings/SettingsView.swift` : second `struct SettingsView` (l'actif est
  `Views/Profile/SettingsView.swift`). Même risque.
- `HostExplorerView`, `HostPreferencesView` : aucun call site.
- `GuestExperienceView.swift:1605` `reactionsSection` : définie, jamais référencée.
- `relay-server/public/host/` : entièrement mort (`host.js:894-897` redirige).
- `relay-server/public/app.js:2950` référence `#end-screen`, absent de `index.html`.
- `window.shareSouvenirs` (`app.js:9076`) : aucun appelant.
- `relay-server/public/app.js:8712` `_souvResolveNames` : défini, jamais appelé.

### F. Tâches à créer (décision humaine requise)

1. **P0** — `sbauth` : signer ou supprimer. Arbitrer entre les deux options.
2. **P1** — Brancher la modération host web (photo + message).
3. **P1** — Contrôle d'hôte du concours (fermer/podium) : aucune surface ne l'a.
4. **P1** — `host:resumeParty` côté web.
5. **P1** — Trancher B : compléter la modération, ou masquer le basculeur en release.
6. **P1** — Sort de `SocialMixGuest/` : supprimer ou faire une vraie cible.
7. **P1** — SOS Banger : implémenter ou retirer des documents de référence du projet.
8. **P1** — Emoji guest iOS non transmis + compteurs d'historique figés à 0.
9. **P2** — Routes `/cgu`, `/privacy`, `/legal` manquantes dans `ahouai-web`.
10. **P2** — Placeholders App Store (`id6470000000`, `id0`).
11. **P2** — Vérifier à la main `AUTO_APPROVE_GUESTS` dans le tableau de bord Render.

---

*Audit exécuté le 3 octobre 2026 en lecture seule sur les trois dépôts. Aucune modification,
aucun commit applicatif, aucune PR corrective. Le protocole demandait un enregistrement dans
`~/App Workshop/Virtual DJ V3/audits/` ; ce dossier n'étant pas partagé avec cette session, le
rapport est versionné dans `relay-server/audits/`, dossier déjà utilisé pour l'audit FTMP63, et
arrivera sur le Mac au prochain `git pull`.*
