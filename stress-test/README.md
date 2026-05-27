# SocialMix — Stress Test Harness

Harnais de test de charge pour le relay-server Socket.IO.  
Simule des dizaines à centaines d'invités web simultanés avec le **protocole exact** du vrai client guest.

---

## Prérequis

```bash
# Depuis le dossier relay-server/
npm install   # socket.io-client est déjà en devDependencies
```

Le serveur relay doit tourner (local ou distant) avant de lancer le test.

```bash
# Terminal 1 — démarrer le serveur
npm run dev
```

---

## Lancer un scénario

Tous les scénarios se lancent depuis `relay-server/` :

```bash
node stress-test/stress.js
```

### Variables de configuration

| Variable | Défaut | Description |
|---|---|---|
| `TARGET_URL` | `http://localhost:3069` | URL du relay-server |
| `SCENARIO` | `SINGLE_PARTY` | Scénario à exécuter |
| `NUM_GUESTS` | `50` | Nombre total de guests |
| `NUM_PARTIES` | `5` | Nombre de soirées (MULTI_PARTY) |
| `GUESTS_PER_PARTY` | `20` | Guests par soirée (MULTI_PARTY) |
| `DURATION_SEC` | `60` | Durée de la charge soutenue (s) |
| `RAMP_SEC` | `30` | Durée de la montée progressive (s) |

---

## Scénarios

### 1. SINGLE_PARTY — montée progressive

1 soirée, montée progressive jusqu'à `NUM_GUESTS`, puis charge soutenue.

```bash
# 50 guests, 30s ramp, 60s sustain (rapide)
SCENARIO=SINGLE_PARTY NUM_GUESTS=50 DURATION_SEC=60 node stress-test/stress.js

# 150 guests, 60s ramp, 120s sustain
SCENARIO=SINGLE_PARTY NUM_GUESTS=150 RAMP_SEC=60 DURATION_SEC=120 node stress-test/stress.js
```

### 2. MULTI_PARTY — isolation inter-soirées

`NUM_PARTIES` soirées concurrentes. Vérifie qu'aucun guest ne reçoit l'état d'une autre soirée.

```bash
# 15 soirées × 20 guests = 300 clients simultanés
SCENARIO=MULTI_PARTY NUM_PARTIES=15 GUESTS_PER_PARTY=20 DURATION_SEC=90 node stress-test/stress.js
```

**Assertion critique** : le rapport indique `0 cross-party leaks`. Tout autre chiffre = bug d'isolation.

### 3. RECONNECT_STORM — coupure WiFi simulée

80 guests connectés → déconnexion simultanée de 70% → reconnexion de tous en < 5s.

```bash
# Storm standard
SCENARIO=RECONNECT_STORM NUM_GUESTS=80 node stress-test/stress.js

# Storm avec serveur distant
SCENARIO=RECONNECT_STORM NUM_GUESTS=80 TARGET_URL=https://ton-server.onrender.com node stress-test/stress.js
```

### 4. SOAK — charge soutenue longue durée

50 guests actifs pendant 30-60 min pour détecter les fuites mémoire.

```bash
# 30 min de soak
SCENARIO=SOAK NUM_GUESTS=50 DURATION_SEC=1800 node stress-test/stress.js

# Contre un serveur de staging
SCENARIO=SOAK NUM_GUESTS=50 DURATION_SEC=3600 TARGET_URL=https://staging.onrender.com node stress-test/stress.js
```

### 5. HOST_UNDER_FIRE — vrai iPhone hôte sous pression ⭐

**Rejoindre une vraie soirée EXISTANTE** sur ton iPhone (sans créer de fausse soirée).  
Lance d'abord la soirée depuis l'app iOS, note le code, puis bombarde depuis le Mac.

```bash
# iPhone hôte → démarrer la soirée (ex. code TEUF25)
# Puis sur le Mac :
SCENARIO=HOST_UNDER_FIRE PARTY_CODE=TEUF25 NUM_GUESTS=30 DURATION_SEC=120 \
  TARGET_URL=http://192.168.1.x:3069 node stress-test/stress.js

# Contre le serveur Render (prod/staging)
SCENARIO=HOST_UNDER_FIRE PARTY_CODE=TEUF25 NUM_GUESTS=50 DURATION_SEC=180 \
  TARGET_URL=https://ton-server.onrender.com node stress-test/stress.js
```

**Ce que ça teste** — l'app hôte reste-t-elle fluide pendant que :
- 30-50 guests votent simultanément (track + genre)
- Le DJ Brain reçoit des votes de genre en continu → re-calcule
- Des suggestions et SOS Bangers arrivent toutes les ~15s
- Des messages chat et photos (Cloudinary) arrivent en rafale
- Des participants entrent le concours déguisement

**Vérifications manuelles sur le téléphone** :
- [ ] UI Cockpit/CockpitView reste à 60 fps (pas de stuttering)
- [ ] DJ Brain continue de proposer des titres (logs `[DJBrain] ✅ Accepted`)
- [ ] Le leaderboard se met à jour
- [ ] Les suggestions apparaissent dans la liste
- [ ] Pas de crash / disconnect hôte inopiné

---

## Métriques serveur optionnelles

Pour obtenir des métriques côté serveur (RAM, event loop, sockets actives) **sans impacter la prod** :

### Étape 1 — Ajouter l'import dans `server.js`

```js
// En haut de server.js, après les autres imports :
import { startMetrics } from './stress-test/metrics.js';

// Dans boot(), après server.listen(...) :
startMetrics(io, parties);
```

### Étape 2 — Activer avec le flag

```bash
# Terminal 1 — serveur avec métriques
STRESS_METRICS=1 npm run dev

# Terminal 2 — lancer le stress test
SCENARIO=SINGLE_PARTY NUM_GUESTS=100 node stress-test/stress.js
```

**Désactivé par défaut** : sans `STRESS_METRICS=1`, le module est un no-op complet.

---

## Rapport de résultats

Le rapport est affiché en console et sauvegardé dans `stress-test/results/` :

```
═══════════════════════════════════════════════════════════
  STRESS TEST REPORT — SINGLE_PARTY
═══════════════════════════════════════════════════════════
  Duration:       62.3s
  Latency p50:    18.4ms
  Latency p95:    87.2ms
  Latency p99:    203.5ms
  Latency max:    412.0ms
  Votes emitted:  1247
  Votes received: 1247
  ...

  CHECKS:
  ✅ Latency p95 < 500ms: 87.2ms
  ✅ Latency p99 < 1000ms: 203.5ms
  ✅ Peak RAM < 400 MB: 124.3 MB
  ✅ No cross-party leaks (MULTI_PARTY): 0 leaks
  ✅ No unexpected disconnects: 0
  ✅ No unhandled errors: 0
  ✅ Reconnect success rate 100% (RECONNECT_STORM): N/A

  VERDICT: PASS ✅
═══════════════════════════════════════════════════════════
```

### Critères PASS/FAIL

| Critère | Seuil |
|---|---|
| Latence p95 | < 500ms |
| Latence p99 | < 1000ms |
| RAM au pic | < 400 MB |
| Fuites inter-soirées | 0 |
| Déconnexions inattendues | 0 |
| Erreurs non gérées | 0 |
| Taux récupération reconnexion | 100% |

---

## Notes techniques

- Le harnais reproduit **exactement** le cycle de vie d'un vrai guest web (`guest:join` → `party:state` → `session:token` → boucle d'activité → `guest:resume` sur reconnexion).
- Les photos envoyées sont des **URLs Cloudinary** (jamais de base64 en stress test).
- La reconnexion utilise d'abord `guest:resume` avec `sessionToken`, puis fallback sur `guest:join`.
- Les reconnexions sont **bornées** : pas de boucle infinie.
- Le module métriques serveur est derrière `STRESS_METRICS=1` — **pas d'import conditionnel à retirer** en prod, le no-op est dans le module lui-même.
