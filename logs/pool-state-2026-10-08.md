# État du pool DJ Brain — 2026-10-08

_Rapport automatique hebdomadaire (cron `pool-state-weekly`)._

## 📊 Vue d'ensemble

| Catégorie | Nombre |
|---|---|
| Total BDD | **3 154** |
| Pool éligible DJ Brain (complete + platine, suggestable) | **2 066** |
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
| **takeoff** | 513 | 200 | ✅ 257% |
| **groove** | 460 | 300 | ✅ 153% |
| **party** | 286 | 350 | 🟡 82% |
| **closing** | 81 | 150 | 🔴 54% |
| _Total_ | _2 066_ | _1350_ | _153%_ |

## ⚡ Pool éligible par phase × energy range

| Phase | low (1-3) | mid (4-6) | high (7-10) |
|---|---|---|---|
| **arrival** | 57 | 115 | 19 |
| **ambiance** | 11 | 397 | 124 |
| **takeoff** | 1 | 39 | 462 |
| **groove** | 3 | 34 | 420 |
| **party** | 0 | 5 | 280 |
| **closing** | 1 | 4 | 76 |

## 🎨 Pool éligible par phase × genreBDD (top 5 par phase)

- **arrival** : Hip-Hop (51), Rock (31), Pop (31), Chill (20), COCOVARIET (17)
- **ambiance** : Hip-Hop (122), Pop (101), Rock (75), House (29), Latin (28)
- **takeoff** : House (149), Hip-Hop (66), Pop (42), Rock (33), Disco (33)
- **groove** : House (176), Hip-Hop (56), Pop (41), Electro (37), Disco (33)
- **party** : House (108), Electro (64), Rock (32), Hip-Hop (27), Pop (22)
- **closing** : Pop (16), Rock (16), Disco (15), COCOVARIET (12), Latin (8)

## 🔴 Carences par phase (sous la cible)

| Phase | Actuel | Cible | Manque |
|---|---|---|---|
| **closing** | 81 | 150 | **69** |
| **party** | 286 | 350 | **64** |

## 🟠 Carences fines par phase × energy (<30 tracks)

| Phase | Energy | Tracks |
|---|---|---|
| **party** | low (1-3) | 0 |
| **takeoff** | low (1-3) | 1 |
| **closing** | low (1-3) | 1 |
| **groove** | low (1-3) | 3 |
| **closing** | mid (4-6) | 4 |
| **party** | mid (4-6) | 5 |
| **ambiance** | low (1-3) | 11 |
| **arrival** | high (7-10) | 19 |

## 📋 Actions recommandées

- **Prioriser les imports sur les 2 phase(s) en carence** : closing (+69 à combler), party (+64 à combler)
- **Review manuelle** : 44 tracks `confidence=low` attendent un arbitrage.

---
_Généré le 2026-10-08T14:25:53.594Z par `pool_state_report.mjs`._
