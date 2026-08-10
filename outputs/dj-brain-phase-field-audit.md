# 🔬 Audit DJBrain.swift — Phase Field Investigation

> Généré le 2026-08-10  
> Branche iOS : `design-refresh-2026-may` (commit ede5dc8)  
> READ-ONLY — Aucune modification code

---

## A. Champ utilisé par le pool phase-first

**DJBrain.swift utilise `KnownTrack.phase` — PAS `partyMoment`.**

### Preuves

| Ligne | Fonction | Code | Rôle |
|-------|----------|------|------|
| L1537 | First Track Doctrine | `known.phase == "arrival"` | Filtre arrival-tagged |
| L1652 | SAFE base filter | `guard ... let phase = known.phase, !phase.isEmpty` | Exclut tracks sans phase |
| L1663 | Phase-first filter | `if let trackPhase = known.phase` | Filtre phase compatible |
| L1669 | Phase-first filter alt | `if let altPhase = known.phaseAlternate` | Check phase secondaire |
| L1833 | Banger phase match | `trackKnowledge[normKey]?.phase == stage.rawValue` | Bonus banger si même phase |
| L1888 | Scoring curated | `if let trackPhase = self.trackKnowledge[normKey]?.phase` | +60 match, +5 adjacent, -1M mismatch |

### Struct `KnownTrack` (L53-81)
```swift
struct KnownTrack {
    var phase: String?           // ← UTILISÉ par DJBrain
    var phaseAlternate: String?  // ← UTILISÉ par DJBrain
}
```

### Valeurs enum acceptées (DJBrain.Stage, L205-210)
```
arrival → ambiance → takeoff → groove → party → closing
```

### Compatibilité adjacente (L1394-1399)
```swift
"arrival":  ["arrival", "ambiance"]
"ambiance": ["ambiance", "arrival", "takeoff"]
"takeoff":  ["takeoff", "ambiance", "groove"]
"groove":   ["groove", "takeoff", "party"]
"party":    ["party", "groove", "closing"]
"closing":  ["closing", "party"]
```

---

## B. Struct `TrackPerformance` (L85) — contient `partyMoment`

```swift
struct TrackPerformance: Codable {
    var partyMoment: String   // warm-up | peak | closing | all
}
```

> ⚠️ `TrackPerformance.partyMoment` est chargé depuis le `/api/tracks/snapshot` endpoint mais **N'EST JAMAIS UTILISÉ** par la logique de sélection phase-first du DJBrain. Il sert uniquement au scoring performance historique.

---

## C. Verdict — Mapping complet

| Composant | Champ Swift | Champ MongoDB | Valeurs | Statut |
|-----------|-------------|--------------|---------|--------|
| **Phase-first pool** | `KnownTrack.phase` | `track.phase` | arrival/ambiance/takeoff/groove/party/closing | ✅ ACTIF |
| **Phase alternate** | `KnownTrack.phaseAlternate` | `track.phaseAlternate` | idem | ✅ ACTIF |
| **First Track Doctrine** | `KnownTrack.phase` | `track.phase` | `"arrival"` | ✅ ACTIF |
| **Banger phase match** | `KnownTrack.phase` | `track.phase` | `stage.rawValue` | ✅ ACTIF |
| **Scoring +60/-1M** | `KnownTrack.phase` | `track.phase` | 6 phases | ✅ ACTIF |
| **Editorial seed** | `SeedTrack.phase` | `track.phase` | 6 phases | ✅ ACTIF |
| **Performance snapshot** | `TrackPerformance.partyMoment` | `track.partyMoment` | warm-up/peak/closing/all | 🟡 NON UTILISÉ pour sélection |

---

## D. Distribution réelle des champs

### `track.phase` (6 valeurs granulaires — **LE BON CHAMP**)

| Source | arrival | ambiance | takeoff | groove | party | closing | null | Total |
|--------|---------|----------|---------|--------|-------|---------|------|-------|
| **editorial_seed.json (embarqué)** | 142 (8%) | 495 (27%) | 485 (26%) | 383 (21%) | 227 (12%) | 99 (5%) | 0 | **1 831** |
| **MongoDB Atlas** | 160 | 531 | 509 | 404 | 236 | 103 | 867 | **2 810** |

> ✅ **82% des tracks MongoDB ont un `phase` renseigné** (1 943/2 810)  
> ✅ **100% des tracks du seed embarqué ont un `phase`** (1 831/1 831)  
> ✅ Distribution équilibrée : pas de dominance "all"

### `track.partyMoment` (3 valeurs grossières — **LE MAUVAIS CHAMP**)

| Source | all | warm-up | peak | closing | Total |
|--------|-----|---------|------|---------|-------|
| **editorial_seed.json** | 1 458 (80%) | 56 (3%) | 316 (17%) | 1 (0%) | **1 831** |
| **MongoDB Atlas** | 2 437 (87%) | 56 (2%) | 316 (11%) | 1 (0%) | **2 810** |

> ⚠️ 87% de `partyMoment` = `"all"` — ce champ est une vue simplifiée 3-phases, pas la source de vérité

---

## E. Conclusion — L'audit v2 était TROMPEUR

### Ce que l'audit v2 disait (FAUX)
> "92% hors-phase", "2437/2810 tracks sont all", "cause racine : batch classification a mis all partout"

### La réalité
L'audit v2 comparait `hostplaybackhistory.phase` (la phase affichée = arrival/groove/etc) avec `track.partyMoment` (une vue simplifiée 3-phases). Ce sont **deux systèmes différents** :

```
partyMoment = "all"        ← Vue simplifiée (warm-up/peak/closing/all)
phase       = "ambiance"   ← Vue granulaire (arrival/ambiance/takeoff/groove/party/closing)
```

Un track avec `partyMoment="all"` et `phase="ambiance"` sera correctement sélectionné par DJBrain en phase ambiance grâce au champ `phase`. L'audit v2 le comptait comme "hors-phase" à tort.

### Verdict

| Affirmation audit v2 | Statut | Réalité |
|-----------------------|--------|---------|
| "87% tracks sont all" | ❌ FAUX | C'est `partyMoment` = "all", pas `phase`. DJBrain utilise `phase` qui a 82% de coverage |
| "Phase-first sélection impossible" | ❌ FAUX | Le pool phase-first fonctionne sur `KnownTrack.phase` (1831 tracks dans le seed) |
| "Cause racine: batch mit all partout" | ❌ FAUX | Le batch met bien `phase` granulaire. `partyMoment` est un champ accessoire |
| "92% hors-phase" | ⚠️ À RECALCULER | Recalculer avec `track.phase` au lieu de `track.partyMoment` |

### Action requise
1. **Relancer un audit v3** avec le bon champ `track.phase` pour mesurer la vraie conformité
2. **Ne PAS re-batch les 2437 tracks "all"** — ce n'est pas nécessaire
3. **Optionnel** : nettoyer `partyMoment` pour refléter `phase` (cohérence) ou le retirer du schema

---

*Audit READ-ONLY — Aucune modification appliquée*
