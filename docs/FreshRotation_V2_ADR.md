# ADR : Fresh Rotation V2 — Adaptive Pool Phase

**Date** : 12 août 2026  
**Statut** : Accepté  
**Auteur** : atelier doctrine Jean-Sé (12/08 15h30)  
**Task** : #44

## Contexte

Fresh Rotation V1 utilisait un scoring par tiers temporels discrets avec cliffs brutaux :
- `PLAYED_UNDER_15D_AGO → -100`
- `PLAYED_15_TO_30D_AGO → +10`
- `PLAYED_OVER_30D_AGO → +30`
- `PLAYED_IN_LAST_3_PARTIES → -80` (additif)

Problèmes V1 :
1. **Cliff brutal à 15 jours** : un track joué il y a 14j et un joué il y a 16j avaient un écart de 110 points
2. **Pas de granularité** : un track joué il y a 16j et un joué il y a 29j avaient le même score
3. **Double pénalité** : le malus `LAST_3_PARTIES` se cumulait avec le tier temporel, rendant certains tracks quasi-injouables

## Décisions

### 1. Décroissance continue exponentielle (TAU=15)

```
freshnessScore = 100 × (1 − e^(−daysAgo / 15))
```

| daysAgo | Score |
|---------|-------|
| 0       | 0     |
| 5       | 28    |
| 10      | 49    |
| 15      | 63    |
| 20      | 74    |
| 30      | 86    |
| 60      | 98    |
| never   | 100   |

Justification : courbe naturelle sans cliff. Un track récupère ~63% de sa fraîcheur en 15 jours, ~86% en 30 jours. Pas de seuil artificiel.

### 2. Exemption banger par phase (BANGER_BOOST = +20, iOS-side)

Les tracks flaggés `isBanger: true` reçoivent un bonus de +20 points côté DJBrain iOS.
Ce bonus est appliqué **uniquement en phase takeoff/peak**, pas en arrival/chill.
Le serveur ne gère pas le boost — il expose `isBanger` dans le catalogue, DJBrain décide.

### 3. Guest suggestion override

Si un guest suggère un track récemment joué, le track est quand même accepté
dans la queue de suggestions mais son score de fraîcheur n'est pas artificiellement gonflé.
Le DJ (host) voit le track dans la queue avec son score réel et décide.

### 4. Pas d'exclusion dure de titre

Aucun track n'est jamais techniquement exclu du pool par la fraîcheur.
Un score de 0 (joué à l'instant) rend le track très défavorisé mais pas impossible.
Doctrine : « BDD prime sur algo » — les données informent, l'algo suggère, le host décide.

### 5. Payload versionné (`?v=2`)

Pour éviter de casser l'iOS déployé, le endpoint supporte un query param `?v=2` :
- **Sans `?v=2`** (legacy) : `scores[deezerId] = number` (tier value: 30/10/-100)
- **Avec `?v=2`** (nouveau) : `scores[deezerId] = { freshnessScore, lastPlayedAt, lastPlayedPhase, playedInPartyCodes }`

## Conséquences

### Breaking change payload
- Le nouveau format V2 est un objet au lieu d'un scalaire
- Mitigé par le query param `?v=2` (zero-risk rolling deploy)
- iOS Prompt B enverra `?v=2` explicitement

### Perte du malus `PLAYED_IN_LAST_3_PARTIES` en mode legacy
- Le scoring continu single-value ne peut pas exprimer cette pénalité additionnelle contextuelle
- Acceptable : Prompt B iOS suivra rapidement et migrera en `?v=2`
- En V2, `playedInPartyCodes` est exposé → DJBrain pourra implémenter sa propre logique

### Migration iOS obligatoire (Prompt B)
- `DJBrain.freshnessScores` passe de `[String: Int]` à `[String: FreshnessEntry]`
- `loadFreshnessScores()` ajoute `?v=2` à l'URL
- Scoring composite intègre `freshnessScore` continu + `BANGER_BOOST` conditionnel

### Curation bangers
- Jean-Sé fournira la liste initiale de bangers à flagger via script backfill
- Le champ `isBanger` existe déjà dans Track.js (L62)
- Index ajouté pour requêtes filtrées performantes

## Références

- SPEC : `Social M/SPEC_FreshRotation_V1.md`
- Scoring service : `relay-server/services/freshnessScoring.js`
- Tests : `relay-server/tests/unit/freshnessScoring.test.js`
- Track schema : `relay-server/models/Track.js` (isBanger L62)
