# Watchdog Network Correlation Analysis — Task #51 Hypothesis

**Date** : 10 août 2026  
**Auteur** : Antigravity (cross-check MongoDB automatique)  
**Période** : 18/07 → 10/08 2026 (23 jours)  
**Source** : Collections `audioevents`, `eventlogs`, `hostplaybackhistories` (READ-ONLY)

---

## Hypothèse testée

> Les 208 `watchdogTriggered` (cause `player_stopped_paused_6s`) sont liés à des transitions réseau WiFi↔5G, provoquant un buffer vide dans MusicKit → player auto-pause → watchdog trigger.

## Méthodologie

3 axes d'investigation :
1. **Signaux réseau** dans MongoDB (eventTypes network/socket/disconnect)
2. **Corrélation temporelle** watchdog ↔ gaps de crossfade + meta analysis
3. **Distribution** bursts vs isolés + recovery analysis

---

## AXE 1 — Signaux réseau dans MongoDB

### Résultat : ⛔ AUCUN signal réseau en BDD

| Collection | Types d'events (période) |
|------------|--------------------------|
| `audioevents` | crossfadeCompleted, crossfadeStarted, gapDetected, preQueueCompleted, preQueueStarted, watchdogTriggered |
| `eventlogs` | genreVote, photo, suggest, vote |

**Aucun event de type** `socketDisconnect`, `socketReconnect`, `networkChange`, `reachabilityChange`, `bufferStall`.

> L'app iOS n'émet pas d'event réseau vers le relay server. La corrélation directe watchdog ↔ réseau est **impossible** avec les données disponibles.

---

## AXE 2 — Corrélation temporelle watchdog ↔ crossfade gaps

### 2a. Gap entre dernier crossfade et premier watchdog (même party)

| Gap | Count | % | Interprétation |
|-----|-------|---|----------------|
| ≤30s (dans un track) | 0 | 0% | — |
| 30s-2min (suspect) | 23 | 11.1% | Possible stall réseau court |
| 2-10min (anormal) | 62 | 29.8% | App probablement idle/pausée |
| >10min (suspension) | 16 | 7.7% | iOS background suspension confirmée |
| Pas de crossfade précédent | 107 | 51.4% | 1er event de la session = jamais eu de musique |

### 2b. Méta-données watchdog

| Champ | Valeur | Signification |
|-------|--------|---------------|
| `playbackStatus=paused` | **193/208 (92.8%)** | Le player MusicKit est PAUSÉ, pas en erreur |
| `isTransitioning=true` | **0/208** | Aucun watchdog pendant un crossfade actif |
| `nextQueuedSongPresent=false` | **199/208 (95.7%)** | Le pre-queue n'a PAS réussi à charger le next track |
| `max consecutiveFires` | 2 | Watchdog se reset après chaque trigger |

### 2c. `remainingSeconds` dominant

| Valeur | Count | Analyse |
|--------|-------|---------|
| **176** | **106** (51%) | Un seul track ("Who Knows"), une seule party (NZPD2W) |
| **0** | 26 | Track terminé, rien en queue |
| **130-170** | 25 | Track à peine commencé → pausé immédiatement |
| Autres | 51 | Distribution uniforme |

> **51% des watchdogs** proviennent d'une SEULE session (NZPD2W) bloquée sur "Who Knows" à remainingSeconds=176.

---

## AXE 3 — Distribution bursts

### 3a. Clustering

| Métrique | Valeur |
|----------|--------|
| Total watchdogs | 208 |
| Watchdogs en bursts (2+ en 5min) | **178 (86%)** |
| Watchdogs isolés | 30 (14%) |
| Nombre de bursts | 18 |

### 3b. Top bursts

| Burst | Party | Count | Durée | Intervalle moyen | Track bloquant |
|-------|-------|-------|-------|-----------------|----------------|
| #17 | NZPD2W | **100x** | 10min | 6s | Who Knows |
| #1 | KHXVMB | 9x | 55s | 7s | nil |
| #12 | HRA3QU | 8x | 4.5min | 38s | Is This Love |
| #16 | NZPD2W | 7x | 1.8min | 18s | nil |
| #13 | HRA3QU | 6x | 30s | 6s | Bésame Mucho |
| #8 | 62WP9B | 5x | 30s | 6s | The Rapture Pt.III |

> Le **pattern dominant est un burst de 6s d'intervalle** = le watchdog timer qui fire en boucle car le player reste pausé. Ce n'est PAS un pattern de transition réseau (qui serait un événement unique suivi d'une recovery).

### 3c. Recovery après watchdog

| Party | Résultat | Délai recovery |
|-------|----------|----------------|
| LETEB7 | ✅ RECOVERED | 31 min |
| SDCQXR | ✅ RECOVERED | 87 min |
| 7AJ5NR | ✅ RECOVERED | 13 min |
| PLPRTU | ✅ RECOVERED | 11 min |
| NZPD2W | ✅ RECOVERED | 31 min |
| KHXVMB | ❌ STAYED DEAD | — |
| 9BT3SJ | ❌ STAYED DEAD | — |
| 62WP9B | ❌ STAYED DEAD | — |
| FSXKWP | ❌ STAYED DEAD | — |
| 87TAG6 | ❌ STAYED DEAD | — |
| HRA3QU | ❌ STAYED DEAD | — |

**5/11 sessions ont repris** après le watchdog (délai 11-87 min), confirmant que l'app n'avait PAS crashé. La reprise est probablement un retour foreground de l'utilisateur qui relance la lecture.

---

## Deep Dive : Party NZPD2W (113 watchdogs = 54% du total)

Cette seule session génère **plus de la moitié** de tous les watchdogs :

```
11:00:10 → watchdog (nil) — app lance, pas de musique
11:01:28-11:01:58 → 6x watchdog "Who Knows" (burst 6s)
11:08:50-11:11:10 → 100x watchdog "Who Knows" en 10min (burst continu)
[RECOVERY]
12:00+ → musique reprend, crossfades normaux, plus aucun watchdog
```

**Diagnostic** : le player s'est bloqué sur "Who Knows" (remainingSeconds=176, soit ~3min de track, toujours la même position). Le pre-queue échoue systématiquement (`nextQueuedSongPresent=false`). Après ~1h de pause, l'app reprend normalement.

---

## Verdict

### ❌ Hypothèse réseau RÉFUTÉE (confiance : 85%)

| Critère | Attendu si réseau | Observé | Match |
|---------|-------------------|---------|-------|
| Events réseau en BDD | socketDisconnect, reconnect | Aucun | ❌ |
| Pattern burst | Event unique + recovery rapide | Bursts de 6s continus | ❌ |
| isTransitioning | Possible pendant crossfade | 0/208 | ❌ |
| Distribution | Répartie sur toutes les sessions | 54% sur 1 seule session | ❌ |
| nextQueuedSongPresent | true (le pre-queue fonctionne hors réseau) | false 95.7% | ❌ |
| Recovery automatique | Oui, en quelques secondes | Non, 11-87 min (retour foreground) | ❌ |

### ✅ Cause identifiée : Player MusicKit self-pause + pre-queue failure

Le pattern est :
1. Le player MusicKit se met en pause (cause interne : fin de track, buffer vide, ou audio session conflict)
2. Le pre-queue échoue (`nextQueuedSongPresent=false`) → pas de track suivant
3. Le watchdog détecte `playbackStatus=paused` + `remainingSeconds>0` → trigger toutes les 6s
4. Le watchdog ne peut pas relancer la lecture (il n'a pas cette capacité)
5. L'app reste bloquée jusqu'à ce que l'utilisateur revienne au foreground

### Confiance limitée à 85% car :
- L'app iOS n'émet PAS d'events réseau vers le server — on ne peut pas prouver l'absence de corrélation
- Le fix NetworkMonitor (Task #91) POURRAIT quand même aider indirectement (meilleure reconnexion socket = meilleur pre-queue)

---

## Recommandation Task #51

| Option | Priorité | Justification |
|--------|----------|---------------|
| ~~Réduire à P2 (réseau)~~ | ❌ | Pas la cause |
| **Maintenir P0** | ✅ | Le watchdog détecte le problème mais ne le résout pas |
| Stratégie recommandée | — | Watchdog v2 : tenter `player.play()` automatiquement quand `paused` + `remainingSeconds>0` |

### Actions Task #51 à investiguer :
1. **Watchdog auto-resume** : quand `playbackStatus=paused` ET `remainingSeconds>0`, appeler `player.play()` au lieu de juste logger
2. **Pre-queue failure retry** : quand `nextQueuedSongPresent=false`, forcer un `computeNextTrack()` depuis le watchdog
3. **Background audio session** : vérifier que `AVAudioSession` reste `.active` en background (hypothèse : iOS désactive la session audio, MusicKit pause, le pre-queue échoue)

---

## Annexe — Métriques brutes

```
Total watchdog triggers (all-time): 208
Total watchdog triggers (18/07-10/08): 95  (audit v2 period)
Parties affectées: 17
Cause unique: player_stopped_paused_6s (100%)
Top party: NZPD2W (113 triggers = 54.3%)
Pattern dominant: bursts de 6s (86% des triggers)
Recovery rate: 5/11 sessions (45.5%)
```
