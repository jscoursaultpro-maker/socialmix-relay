# État du pool DJ Brain — 2026-10-09

_Rapport automatique hebdomadaire (cron `pool-state-weekly`)._

## 📊 Vue d'ensemble

| Catégorie | Nombre |
|---|---|
| Total BDD | **3 158** |
| Pool éligible DJ Brain (complete + platine, suggestable) | **2 063** |
| └─ dont platine (isVerified=true) | 357 |
| └─ dont complete | 1 783 |
| Qualité partielle (à promouvoir) | 9 |
| Qualité empty (candidats) | 55 |
| └─ dont ISRC propre (gisement propre) | **0** |
| Confidence `low` en attente de review manuelle | 44 |
| Confidence `medium` | 129 |

## 🎯 Pool éligible par phase

| Phase | Tracks | Cible | Statut |
|---|---|---|---|
| **arrival** | 191 | 150 | ✅ 127% |
| **ambiance** | 535 | 200 | ✅ 268% |
| **takeoff** | 514 | 200 | ✅ 257% |
| **groove** | 461 | 300 | ✅ 154% |
| **party** | 284 | 350 | 🟡 81% |
| **closing** | 78 | 150 | 🔴 52% |
| _Total_ | _2 063_ | _1350_ | _153%_ |

## ⚡ Pool éligible par phase × energy range

| Phase | low (1-3) | mid (4-6) | high (7-10) |
|---|---|---|---|
| **arrival** | 57 | 115 | 19 |
| **ambiance** | 11 | 397 | 124 |
| **takeoff** | 1 | 40 | 462 |
| **groove** | 3 | 35 | 420 |
| **party** | 0 | 0 | 284 |
| **closing** | 0 | 0 | 78 |

## 🎨 Pool éligible par phase × genreBDD (top 5 par phase)

- **arrival** : Hip-Hop (51), Rock (31), Pop (31), Chill (20), COCOVARIET (17)
- **ambiance** : Hip-Hop (122), Pop (101), Rock (75), House (29), Latin (28)
- **takeoff** : House (149), Hip-Hop (66), Pop (42), Electro (34), Rock (33)
- **groove** : House (176), Hip-Hop (57), Pop (41), Electro (37), Disco (33)
- **party** : House (108), Electro (62), Rock (32), Hip-Hop (26), Pop (22)
- **closing** : Pop (16), Rock (15), Disco (15), COCOVARIET (11), Latin (7)

## 🔴 Carences par phase (sous la cible)

| Phase | Actuel | Cible | Manque |
|---|---|---|---|
| **closing** | 78 | 150 | **72** |
| **party** | 284 | 350 | **66** |

## 🟠 Carences fines par phase × energy (<30 tracks, hors crans doctrinalement interdits)

| Phase | Energy | Tracks |
|---|---|---|
| **party** | mid (4-6) | 0 |
| **takeoff** | low (1-3) | 1 |
| **groove** | low (1-3) | 3 |
| **ambiance** | low (1-3) | 11 |
| **arrival** | high (7-10) | 19 |

## 📋 Actions recommandées

- **Prioriser les imports sur les 2 phase(s) en carence** : closing (+72 à combler), party (+66 à combler)
- **Review manuelle** : 44 tracks `confidence=low` attendent un arbitrage.

---
_Généré le 2026-10-09T10:02:41.127Z par `pool_state_report.mjs`._
