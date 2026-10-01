# Dramaturgie DJ Brain & final « Memories » — complément de curation

**Version : 1er octobre 2026.** Complément à `DOCTRINE_PREMIUM_V2.md`, à lire à chaque run.

**Priorité : en cas de divergence sur la définition d'une phase, sur l'énergie, ou sur le final, CE FICHIER prime sur `DOCTRINE_PREMIUM_V2.md` §7.** Il traduit ce que le DJ Brain fait réellement de tes champs, pour que les titres atteignent l'objectif de la dramaturgie — dont le bouquet final « Memories / feu d'artifice ».

Rappel inchangé : tu ne touches **jamais** aux données comportementales (votes, suggestions, `performance.*`, historique). Elles sont lues par le DJ Brain ailleurs, pas par toi.

---

## 1. Ce que le DJ Brain fait de tes champs

Tu ne tagues pas dans le vide : le DJ Brain **score** chaque titre par phase. Tes champs doivent coller à la phase visée, sinon le titre est mal placé ou jamais joué.

**Énergie par phase (le brain score la proximité à la cible)** — ton `energy` doit tomber dans la bande de la `phase` choisie :

| phase | bande energy | BPM indicatif | rôle |
|---|---|---|---|
| arrival | 3.5–5 | 70–105 | apéro, madeleine douce, ouverture émotionnelle |
| ambiance | 5–6.5 | 80–115 | warm-up chaleureux |
| takeoff | 6.5–7.5 | 100–125 | ça se lève |
| groove | 7.5–8.5 | 115–130 | dancefloor lancé |
| party | 8.5–9.5 | 120–135 | peak time |
| **closing (Memories)** | **7–10** | flexible, souvent soutenu | **feu d'artifice : hymnes à chanter** |

**Genres par phase (routing du brain — un titre hors routing est fortement pénalisé dans cette phase)** :
- arrival : Chill, Pop, Disco, R&B, Rock, COCOVARIET (doux)
- ambiance : + Latin, Afro, Hip-Hop, House léger
- takeoff : House, Electro, Hip-Hop, Latin, Pop, Afro, Disco
- groove, party : **tous genres**
- closing : Pop, Rock, Disco, R&B, Latin, Hip-Hop, COCOVARIET

**`isBanger` est un tag de MOMENT, pas de qualité.** Un banger reçoit **+80** s'il est joué dans **sa** phase (`phase` ou `phaseAlternate` = phase courante) et **−20** hors de sa phase. Donc tague `isBanger=true` **uniquement avec la phase où le titre explose vraiment**, et mets son `phaseAlternate` sur la phase adjacente où il marche aussi. Un banger mal phasé fait du mal. En plus, sur les phases hautes (takeoff, groove, party, closing) un banger reçoit **+20 de fraîcheur** (il peut revenir plus tôt). En arrival/ambiance, pas de ce bonus : un vrai banger y est rare.

**`deezerRank` (popularité) joue par phase** : les méga-tubes (`deezerRank` très haut) sont **retenus** en arrival/ambiance (malus) et **lâchés en party** (+30) et en closing (chaleur familière). Ne force pas un hymne ultra-connu en arrival.

**`isEmotional` + BPM ≤ 85 + `phase: arrival` + `deezerRank` haut = candidat « premier titre de soirée »** (First Track Doctrine). Garde un vivier d'ouvertures : arrival, isEmotional=true, BPM lent, connues.

**Champs que le brain lit chez toi** : `phase`, `phaseAlternate`, `energy`, `bpm`, `genreBDD`, `danceability`, `isBanger`, `isEmotional`, `isSingalong`, `deezerRank`, `qualityLevel`. Soigne-les en priorité.

---

## 2. Closing = « Memories » = feu d'artifice (remplace §7.1/7.2 pour cette phase)

**Closing n'est PAS un wind-down.** C'est le bouquet final : des **hymnes fédérateurs que tout le monde chante**, haute énergie (**energy 7–10**). On y place les titres `isBanger` + `isSingalong`, souvent `mood: fun` ou `emotional`, genres Pop / Rock / Disco / Variété (COCOVARIET) / Latin / Hip-Hop.

La **nostalgie douce** (ballades lentes, tempo bas) va en **arrival** (madeleine d'ouverture), **pas** en closing. `phaseAlternate` de closing = **party** (bidirectionnel party ⇄ closing) ; `closing ⇄ arrival` reste autorisé pour les rares titres ballade-souvenir.

Grille des 6 phases (remplace le tableau §7.1) :

| Phase | Rôle | BPM cible | Energy | Exemples |
|---|---|---|---|---|
| arrival | Apéro, **madeleine douce / ouverture émotionnelle** | 70–105 | 3.5–5 | Sade, Norah Jones, Bill Withers « Lovely Day », Piaf |
| ambiance | Warm-up chaleureux | 80–115 | 5–6.5 | Marvin Gaye, Sheeran mid-tempo |
| takeoff | Montée, premiers pas | 100–125 | 6.5–7.5 | Donna Summer, Kool & The Gang |
| groove | Dancefloor stable | 115–130 | 7.5–8.5 | Sister Sledge, Bruno Mars |
| party | Peak time explosion | 120–135 | 8.5–9.5 | Avicii, Guetta, Justice |
| **closing — « Memories »** | **Feu d'artifice : hymnes à chanter en chœur** | flexible, souvent soutenu | **7–10** | Le Lac du Connemara, Alexandrie Alexandrie, Pump It (BEP), Queen « Don't Stop Me Now », Journey « Don't Stop Believin' » |

### Règle de tag du final Memories

Un titre entre en `phase: closing` quand il coche l'esprit « tout le monde chante, bras en l'air, dernier moment » :
- `isSingalong: true` (refrain repris en chœur) et/ou `isBanger: true`,
- `energy` ≥ 7, `mood` ∈ {fun, emotional},
- `genreBDD` ∈ {Pop, Rock, Disco, COCOVARIET, R&B, Latin, Hip-Hop},
- `phaseAlternate: party` (sauf vraie ballade-souvenir → `arrival`).

---

## 3. Titres-étalons du final (format outbox de référence)

```json
{ "title": "Le Lac du Connemara", "artist": "Michel Sardou",
  "genreBDD": "COCOVARIET", "phase": "closing", "phaseAlternate": "party",
  "energy": 8, "bpm": 134, "danceability": 0.72,
  "isBanger": true, "isSingalong": true, "isEmotional": true, "isFiller": false,
  "mood": "emotional", "language": "FR", "era": "80s",
  "tags": ["closing","sing-along","memory-lane","banger-crowd"],
  "partyMoment": "closing", "confidence": "high" }
```
```json
{ "title": "Alexandrie Alexandra", "artist": "Claude François",
  "genreBDD": "Disco", "phase": "closing", "phaseAlternate": "party",
  "energy": 9, "bpm": 128, "danceability": 0.88,
  "isBanger": true, "isSingalong": true, "isEmotional": false, "isFiller": false,
  "mood": "fun", "language": "FR", "era": "70s",
  "tags": ["closing","sing-along","banger-crowd","danceable"],
  "partyMoment": "closing", "confidence": "high" }
```
```json
{ "title": "Pump It", "artist": "Black Eyed Peas",
  "genreBDD": "Hip-Hop", "phase": "closing", "phaseAlternate": "party",
  "energy": 9, "bpm": 154, "danceability": 0.80,
  "isBanger": true, "isSingalong": true, "isEmotional": false, "isFiller": false,
  "mood": "fun", "language": "EN", "era": "2000s",
  "tags": ["closing","peak-time","banger-crowd"],
  "partyMoment": "closing", "confidence": "high" }
```

BPM **technique** (cf. doctrine §3) ; Pump It = 154 réel, pas de half-time ici.

---

## 4. Garde-fou dramaturgie

Avant de valider une track, demande-toi *à quel moment de la soirée elle fait lever ou chanter les gens*, et c'est ça sa `phase`. Garde un équilibre sur l'ensemble : des **ouvertures** (arrival, isEmotional, BPM lent), du **corps de soirée** (takeoff / groove / party), et des **finals** (closing, isSingalong / isBanger). Un run qui ne produit que du « groove filler » est un signal d'alerte (doctrine §11.2).
