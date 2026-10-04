# AUDIT CIBLÉ — Qui émet encore `sbauth` ? — 4 octobre 2026

> **Mode : READ-ONLY STRICT.** Aucune modification, aucun commit applicatif.
> **Doctrine « facts only ».** Chaque ligne porte un `chemin:ligne`. Absence → `N/A` + raison.
>
> Objet : avant de retirer `sbauth` du middleware serveur (`middleware/authGuest.js`, P0 de
> l'audit de parité du 03/10), établir la liste exhaustive de ce qui le **pose** et de ce qui le
> **consomme**, pour savoir ce qui casse.

---

## 📊 Résumé exécutif

**Deux émetteurs. Les deux dans `ahouai-web`. Les deux sur la même ligne de code, à deux
endroits.** Tout le reste est de la consommation côté relais.

**Et le point qui change la nature du chantier : `sbauth` est redondant.** Les deux surfaces web
partagent **déjà** la session Supabase par le même cookie `.ahouai.com`, avec la même
`storageKey`. Le pont `sbauth` double un mécanisme qui existe et qui est documenté comme tel dans
les deux dépôts. Ce n'est donc pas une migration d'authentification : c'est la suppression d'un
contournement devenu inutile.

| Constat | Détail |
|---|---|
| **iOS : rien à faire** | **Zéro occurrence de `sbauth`** dans tout `socialmix-ios`. L'app utilise le vrai JWT Supabase (`AuthService.swift:230`). |
| **Émetteurs réels** | **2**, tous deux dans `ahouai-web`, tous deux dans la construction de l'URL de redirection vers le relais. |
| **`ahouai-web` fait déjà bien ailleurs** | **13 call sites** utilisent `Bearer ${session.access_token}`. Le bon réflexe est déjà majoritaire. |
| **Le relais préfère déjà le vrai JWT** | `getAuthCredential()` (`public/app.js:1866-1878`) retourne le `access_token` Supabase **en premier** et ne retombe sur le cookie `sbauth` qu'à défaut. |
| **Un seul fichier mélange les deux** | `PendingClient.tsx` : `access_token` pour ses propres appels API (`:34`, `:49`), `sbauth` pour la redirection (`:69`). |

**Le défaut de conception, en une phrase.** Dans `FirstTasteClient.tsx`, la session Supabase est
récupérée ligne 300 — le `access_token` est donc **en main** — et le code choisit d'envoyer à sa
place un base64 de `{userId, firstName, email}` (`:330-331`). Le vrai jeton signé est disponible
et écarté.

---

## ÉTAPE 1 — Émetteurs et consommateurs de `sbauth`

### 1.1 — iOS (`socialmix-ios`, branche `design-refresh-2026-may`, HEAD `4c9ce9d`)

**N/A — aucune occurrence.** `grep -rn "sbauth" --include=*.swift .` → **0 résultat**.

L'app iOS ne pose, ne lit et n'envoie jamais `sbauth`. Les seuls jetons qu'elle manipule sont :
- `AuthService.swift:230` — `session.accessToken` (Supabase), le bon chemin ;
- `SpotifyService.swift` (`:37`, `:87`, `:217`, `:228`, `:290-292`, `:322`, `:374`) et
  `KeychainService.swift:74` — OAuth **Spotify**, sans rapport avec l'authentification AhOuai.

**→ Le retrait de `sbauth` n'a aucun impact sur iOS.**

### 1.2 — `ahouai-web` (Next.js, branche `main`, HEAD `4877769`)

| Fichier:ligne | Contexte | Rôle | Flow utilisateur |
|---|---|---|---|
| `src/app/join/[partyCode]/first-taste/FirstTasteClient.tsx:331` | **paramètre d'URL** — `redirectUrl += \`&sbauth=${encodeURIComponent(encoded)}\`` | 🔴 **ÉMETTEUR** | Fin de l'entonnoir d'arrivée : l'invité a suggéré un titre (ou cliqué « Je passe mon tour ») → redirection vers la soirée en direct |
| `src/app/join/[partyCode]/pending/PendingClient.tsx:69` | **paramètre d'URL** — même ligne | 🔴 **ÉMETTEUR** | Salle d'attente : le polling (15 s) détecte que l'hôte a accepté → redirection vers la soirée |
| `src/lib/supabase/client.ts:74` | **purge de cookie** — `if (name.startsWith('sb-') \|\| name === 'sbauth')` dans `forceClearAuthCookies()` | 🧹 nettoyage | Déconnexion / réparation de session |

**Payload émis, identique aux deux endroits :**

```js
const authPayload = { userId: user.id, firstName: …, email: user.email };
const encoded = btoa(JSON.stringify(authPayload));
redirectUrl = `https://join.ahouai.com/?code=${partyCode}&sb=1&sbauth=${encodeURIComponent(encoded)}`;
```

`FirstTasteClient.tsx:294-317` construit ce payload par deux voies : d'abord
`supabase.auth.getSession()` (`:300`), sinon un repli qui **décode le JWT sans le vérifier**
(`:310` — `JSON.parse(atob(accessToken.split('.')[1]))`) pour en extraire `sub`.
`PendingClient.tsx:55-59` n'a que la première voie.

### 1.3 — `socialmix-relay/public/` (branche `main`, HEAD `10eb943`)

Aucun émetteur vers l'extérieur. Le relais **reçoit** `sbauth`, le transforme en cookie, puis le
relit pour ses propres appels API.

| Fichier:ligne | Contexte | Rôle |
|---|---|---|
| `public/app.js:6680` | **lecture du paramètre d'URL** — `urlParamsObj.get('sbauth')` | 📥 ingestion |
| `public/app.js:6712` | **pose le cookie** — `document.cookie = \`sbauth=…; Domain=.ahouai.com; Path=/; Max-Age=<1 an>; Secure; SameSite=Lax\`` | 🔴 **ÉMETTEUR de cookie** (durée **1 an**) |
| `public/app.js:6723` | log d'échec de décodage | diagnostic |
| `public/app.js:1873-1875` | **lecture du cookie** dans `getAuthCredential()` → `{ type: 'sbauth', token }` | 📤 consommation |
| `public/app.js:5291` | **envoi en en-tête** — `{ Authorization: \`Bearer ${cred.token}\`, 'X-Auth-Type': cred.type }` | 📤 **seul point d'envoi réseau** |
| `public/app.js:5292` | branche conditionnelle `if (cred.type === 'sbauth' && … state.partyCode)` | logique dépendante |
| `public/app.js:4288` | commentaire — repli « internal session UUID (sbauth-bypass guests) » | — |
| `public/app.js:1736`, `:1740` | purge des cookies `sb-*` et `sbauth` à la déconnexion | 🧹 nettoyage |
| `public/shared/ui/host-engine.js:84` | commentaire seul (« session sbauth de test = pas de token ») | — |

**Chaîne complète, bout en bout :**

```
ahouai-web                          relais (navigateur)              serveur
───────────────────────────────────────────────────────────────────────────────
FirstTasteClient:331   ──URL──▶   app.js:6680  (lit ?sbauth=)
PendingClient:69                  app.js:6712  (pose cookie, 1 an)
                                  app.js:1873  (relit le cookie)
                                  app.js:5291  ──Bearer + X-Auth-Type──▶
                                                                   authGuest.js:33-64
                                                                   authGuest.js:80-106
```

**Un seul point d'envoi réseau** (`app.js:5291`) et **un seul appelant** de
`getAuthCredential()` (`app.js:5289`). La surface de changement côté relais est donc très
étroite.

---

## ÉTAPE 2 — Qui utilise déjà le vrai `access_token` Supabase

### `ahouai-web` — 13 call sites, tous au bon format

| Fichier:ligne | Appel |
|---|---|
| `components/social/FollowButton.tsx:48`, `:55` | `Bearer ${session.access_token}` |
| `components/social/FriendButton.tsx:34`, `:40` | idem |
| `components/social/VisibilityToggle.tsx:32`, `:38` | idem |
| `components/social/PrivateAfterglowCover.tsx:33`, `:38` | idem |
| `components/profile/CrewsSection.tsx:60`, `:68` | idem |
| `app/mes-suggestions/page.tsx:48-56` | idem, avec garde `if (!session?.access_token)` |
| `app/join/[partyCode]/name/NameClient.tsx:27-38` | idem, avec garde |
| `app/join/[partyCode]/pending/PendingClient.tsx:34`, `:49` | idem |
| `app/join/[partyCode]/first-taste/page.tsx:18-20`, `:60` | récupéré côté serveur, passé en prop `accessToken` au client |

**À noter :** `first-taste/page.tsx` fournit déjà le vrai `access_token` au composant client
(`:60`). `FirstTasteClient` l'utilise pour ses appels API — mais **pas** pour la redirection.
Le jeton nécessaire est déjà là, dans le même composant.

### `socialmix-relay/public/`

| Fichier:ligne | Rôle |
|---|---|
| `app.js:676-690` | **cookie partagé `.ahouai.com`** + `storageKey: sb-<ref>-auth-token` (voir § suivant) |
| `app.js:704`, `:761` | poll de session, `session?.access_token` |
| `app.js:1863` | `getProfileJwt()` → `session?.access_token` |
| `app.js:1870` | `getAuthCredential()` → **priorité au `access_token`** |
| `app.js:4284-4285` | autre chemin `access_token`, avec repli documenté `:4288` |
| `app.js:6862` | `getSession()` |
| `host/host.js:254`, `:258` | `session.access_token` pour l'auth socket — **code mort** (`/host/` redirige, `host.js:894-897`) |

### iOS

`AuthService.swift:230` — `session.accessToken`. Rien d'autre côté AhOuai.

---

## 🔑 Le constat structurant : `sbauth` double un pont qui existe déjà

Les deux surfaces web sont configurées pour **partager la session Supabase par cookie**, sur le
même domaine et avec la même clé :

| | Configuration |
|---|---|
| `ahouai-web` | `src/lib/supabase/client.ts:14-16` — en prod : `cookieOptions: { domain: '.ahouai.com', path: '/', sameSite: 'lax', secure: true }` |
| relais | `public/app.js:676-690` — `cookieDomain = '.ahouai.com'` si `location.hostname` finit par `.ahouai.com` ; `storage: crossDomainStorage` ; `storageKey: sb-<ref>-auth-token` |

Les deux dépôts le disent explicitement dans leurs commentaires :
- `client.ts:4-5` : « Cross-subdomain SSO : les cookies `sb-*` sont scopés `.ahouai.com` en prod
  pour que la session soit partagée entre `ahouai.com` et `join.ahouai.com`. »
- `app.js:674-677` : « stocke la session dans un cookie partagé `.ahouai.com` au lieu de
  localStorage, **pour partager avec ahouai-web** (qui utilise `@supabase/ssr` avec le même
  scope). »

Le relais sait même lire les cookies Supabase **découpés en morceaux** (`sb-*-auth-token.0`,
`.1`…) : `authGuest.js:108-111` les filtre, trie et concatène.

**Conséquence : sur `join.ahouai.com`, la session Supabase est censée être déjà disponible sans
`sbauth`.** Le contournement n'apporte rien de plus — il apporte seulement une authentification
non signée.

### Ce que je ne peux pas affirmer

**N/A — le fonctionnement réel du partage de cookie à l'exécution.** Il se lit dans le code, il
ne se prouve pas par le code. Trois points à vérifier **avant** de supprimer quoi que ce soit :

1. **L'hôte d'accès.** Le test du relais est `/\.ahouai\.com$/` (`app.js:676`). Sur
   `join.ahouai.com` → vrai, cookie partagé. Sur **`socialmix-relay.onrender.com` → faux**,
   repli `localStorage`, **aucun partage**. C'est l'explication la plus plausible de l'existence
   de `sbauth`, et c'est à confirmer : si des invités arrivent par l'URL `.onrender.com`, les
   supprimer d'un coup les déconnecterait.
2. **Le domaine apex.** `"ahouai.com"` ne finit pas par `".ahouai.com"` : sur l'apex, le relais
   retomberait aussi sur `localStorage`. Sans effet ici (le relais est servi sur le
   sous-domaine), mais à garder en tête.
3. **`SameSite=Lax` sur une redirection inter-sites.** La redirection `ahouai.com` →
   `join.ahouai.com` est une navigation de premier niveau, donc `Lax` devrait laisser passer le
   cookie. À constater en conditions réelles plutôt qu'à déduire.

**Le test décisif est simple et sans risque :** sur `join.ahouai.com`, après le parcours
d'arrivée, vérifier dans la console que `_supabaseClient.auth.getSession()` renvoie une session
**sans** paramètre `sbauth` dans l'URL. Si oui, le pont est confirmé redondant.

---

## ÉTAPE 3 — Rapport par surface

### Flows qui utilisent `sbauth` → **à migrer** (2)

| Flow | Fichier:ligne | Changement | Effort |
|---|---|---|---|
| Fin d'entonnoir, après suggestion ou « Je passe mon tour » | `ahouai-web … first-taste/FirstTasteClient.tsx:331` | Retirer `&sbauth=…` de l'URL | XS |
| Sortie de salle d'attente, après acceptation par l'hôte | `ahouai-web … pending/PendingClient.tsx:69` | idem | XS |

### Flows qui utilisent déjà le JWT Supabase → **ne pas toucher** (14)

Les 13 call sites `ahouai-web` listés à l'étape 2, plus `AuthService.swift:230` côté iOS.
Aucun ne dépend de `sbauth`.

### Flows qui utilisent **les deux** → **à nettoyer** (3)

| Flow | Détail |
|---|---|
| `PendingClient.tsx` | `access_token` pour ses appels API (`:34`, `:49`) **et** `sbauth` pour la redirection (`:69`). Deux patrons dans un seul fichier. |
| `FirstTasteClient.tsx` | Reçoit le vrai `accessToken` en prop (`page.tsx:60`), s'en sert pour les appels API, mais émet `sbauth` pour la redirection (`:331`). De plus `:310` **décode un JWT sans le vérifier** pour en tirer `sub` — à supprimer avec le reste. |
| relais `getAuthCredential()` | `public/app.js:1866-1878` : Supabase d'abord (`:1870`), cookie `sbauth` en repli (`:1873-1875`). Retirer le repli laisse le chemin propre intact. |

### Ordre de retrait proposé (à arbitrer, pas à exécuter)

Le sens du retrait compte : supprimer le serveur d'abord déconnecterait les porteurs du cookie
d'un an.

1. **Côté émission d'abord** — retirer `&sbauth=` des deux redirections `ahouai-web`. À partir de
   là, plus aucun nouveau cookie n'est posé.
2. **Observer** — surveiller `[authGuest] auth via cookie sbauth` et `auth via Bearer sbauth`
   dans les logs Render (ces deux lignes existent déjà, `authGuest.js:54` et `:98`). Tant qu'elles
   apparaissent, des porteurs du cookie d'un an sont encore actifs.
3. **Côté relais ensuite** — retirer l'ingestion (`app.js:6680`, `:6712`) et le repli de
   `getAuthCredential()` (`:1873-1875`), en **gardant** la purge (`:1740`) pour nettoyer les
   cookies existants.
4. **Côté serveur en dernier** — retirer les deux blocs `authGuest.js:33-64` et `:80-106`.

**Mesure immédiate, indépendante de tout le reste :** si l'un des deux blocs doit vivre encore un
temps, **le repli par email (`authGuest.js:47-49` et `:91-93`) peut partir tout de suite.** C'est
lui qui rend le jeton forgeable à partir d'une donnée publique. Le supprimer réduit la faille à
« connaître le `supabaseUserId` » — toujours insuffisant, mais nettement moins exposé.

---

## 📎 Annexes

### A. Dépôts à la date de l'audit

| Dépôt | Branche | HEAD |
|---|---|---|
| `socialmix-relay` | `main` | `10eb943` |
| `ahouai-web` | `main` | `4877769` |
| `socialmix-ios` | `design-refresh-2026-may` | `4c9ce9d` |

Les trois clones ont été mis à jour (`git pull`) avant l'audit. `ahouai-web` a avancé depuis
l'audit de parité de la veille (`4877769`, « fix(first-taste): pagination 6+6 », PR #9) : les deux
émetteurs sont inchangés.

Les dépôts correspondent sur le Mac à `~/App Workshop/Virtual DJ V3/{relay-server, ahouai-web,
SocialMixApp}`. Ici ils sont clonés depuis GitHub ; `SocialMixApp` est la racine du dépôt
`socialmix-ios`.

### B. Commandes utilisées

```bash
# Étape 1 — émetteurs
grep -rn "sbauth" socialmix-ios/ --include="*.swift"                  # → 0 résultat
grep -rn "sbauth" socialmix-relay/public/                             # → 11 (consommation)
grep -rn "sbauth" ahouai-web/src/ --include="*.ts" --include="*.tsx"  # → 3 (2 émetteurs + 1 purge)

# Chaîne de transmission
grep -rn "X-Auth-Type\|x-auth-type" socialmix-relay/public/ --include=*.js
grep -rn "getAuthCredential" socialmix-relay/public/app.js

# Étape 2 — usage du vrai JWT
grep -rn "access_token\|supabase\.auth\|getSession()" socialmix-relay/public/ --include=*.js
grep -rn "access_token\|getSession()" ahouai-web/src/ --include=*.ts --include=*.tsx
grep -rn "access_token\|accessToken" socialmix-ios/ --include=*.swift
```

### C. Fichiers lus

| Fichier | Lignes |
|---|---|
| `ahouai-web/src/app/join/[partyCode]/first-taste/FirstTasteClient.tsx` | 285-335 |
| `ahouai-web/src/app/join/[partyCode]/pending/PendingClient.tsx` | 55-75 |
| `ahouai-web/src/lib/supabase/client.ts` | 1-90 |
| `socialmix-relay/public/app.js` | 650-730, 1862-1891 |
| `socialmix-relay/middleware/authGuest.js` | 18-132 (audit du 03/10) |

### D. Rappel du P0 associé

`middleware/authGuest.js:33-64` (en-tête `X-Auth-Type: sbauth` + `Bearer`) et `:80-106`
(cookie `sbauth`) acceptent un jeton **base64 non signé** et résolvent l'utilisateur par
`supabaseUserId`, puis **par email**. 42 routes derrière `verifyGuestAuth`. Détail complet et
portée dans `audits/parite-host-guest-20261003.md`, section « Sécurité ».

---

*Audit exécuté le 4 octobre 2026 en lecture seule sur les trois dépôts. Aucune modification,
aucun commit applicatif, aucune PR corrective. Le présent inventaire prépare une décision ; il
ne l'exécute pas.*
