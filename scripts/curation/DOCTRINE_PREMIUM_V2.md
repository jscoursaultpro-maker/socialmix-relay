# AhOuai — Doctrine Premium V2 pour Curation LLM

**Version : 2.0 — 14 juillet 2026**
**Auteur : Claude (session Cowork Jean-Sé)**
**Statut : Prêt pour validation Jean-Sé avant cycle 2 curation**

---

## Préambule — Pourquoi cette V2

### Contexte

Après échec définitif des 3 APIs majeures pour audio features (Deezer BPM=0 sur 76/77 tracks, Spotify Audio Features bloqué 403 depuis fin 2024, Apple Music ne fournit pas audio features), la curation Claude devient l'**unique voie** pour enrichir BPM/energy/danceability en V1.

### Ce que la V1 (14/07 matin) avait de faible

Analyse honnête du cycle 1 (100 tracks batch_out_007-011) :
- ~40 % des tracks avaient BPM/energy/danceability estimés génériquement (120, 7, 0.78)
- Notes DJ souvent réduites à "Groove standard filler" (~30 occurrences)
- Pas de signal explicite quand j'étais peu confiant
- Marge d'erreur ±10-15 BPM sur tracks house Netherlands anonymes

**Résultat** : qualité "correcte à 85 %" mais Jean-Sé priorise 100 % premium.

### Ce que la V2 apporte

**Trois piliers** :
1. **Confidence flags obligatoires** par track — je signale explicitement ma certitude
2. **Patterns BPM par genre** — référentiel scientifique, pas d'estimation générique
3. **Notes DJ substantielles** — contexte usage réel, corrections documentées

**Cadence revue** : 10 tracks / batch (au lieu de 20), analyse individuelle poussée. Volume V1 réaliste : 150-200 tracks premium au lieu de 500 approximatives.

---

## 1. Confidence flags (nouveau champ obligatoire)

### 1.1 Trois niveaux

**HIGH** — Je connais parfaitement l'artiste et le titre
- Ex : Michael Jackson "Thriller", Daft Punk "Get Lucky", Bad Bunny "Tití Me Preguntó", Indochine "L'aventurier"
- Confidence sur phase + isBanger + genre : 95 %
- Confidence sur BPM/energy/danceability : 85-90 % (via patterns connus)
- BPM cible : ±3 BPM du réel

**MEDIUM** — Je connais l'artiste ou le contexte mais pas la track spécifique
- Ex : Nora En Pure (DJ deep house connue) mais je ne connais pas ce titre précis
- Confidence sur phase + genre : 85 %
- Confidence sur isBanger : 70 % (je ne sais pas si c'est un tube ou un filler dans sa disco)
- BPM cible : ±5-8 BPM
- **Warning si isBanger=true** : justifier obligatoirement

**LOW** — Je ne connais ni l'artiste ni le contexte
- Ex : "Bikini Bandits", "Lumin8", "House Arrest" — labels deep house Netherlands anonymes
- Confidence sur phase : 60 % (basée uniquement sur genre + BPM si connu)
- **isBanger doit être false par défaut** (précaution contre surévaluation)
- BPM cible : ±10-15 BPM
- **isFiller=true probable** sauf signal contraire fort

### 1.2 Champ à ajouter au format batch_out

```json
{
  "confidence": "high|medium|low",
  "confidence_notes": "Explication courte pourquoi ce niveau"
}
```

### 1.3 Règle d'or

**En cas de doute entre 2 niveaux, choisir le plus bas.** Il vaut mieux flag "medium" quand je suis "high but uncertain" que l'inverse.

---

## 2. Patterns BPM par genre (référentiel scientifique)

### 2.1 Grille de référence

| Genre | BPM typique | Range | Half-time perçu | Double-time perçu |
|---|---|---|---|---|
| **House standard** | 122-125 | 118-128 | 61-64 | 244-256 (rarement) |
| **Tech house** | 125-128 | 122-132 | 62-64 | — |
| **Deep house** | 118-125 | 115-125 | 59-62 | — |
| **Melodic techno** | 122-128 | 120-130 | 61-64 | — |
| **Hard techno** | 138-148 | 135-155 | 69-74 | — |
| **Progressive house** | 126-132 | 122-135 | 63-66 | — |
| **Trance** | 132-138 | 128-142 | 66-69 | — |
| **Drum & Bass** | 172-178 | 170-180 | **86-89 (fréquent)** | 344-356 (jamais) |
| **Jungle** | 155-175 | 150-180 | 77-88 | — |
| **Dubstep** | 138-142 | 135-145 | 69-71 | — |
| **Reggaeton** | 92-98 | 88-102 | 46-49 | 184-196 |
| **Afrobeats** | 100-110 | 95-115 | 50-55 | 200-220 |
| **Amapiano** | 108-118 | 105-120 | 54-59 | — |
| **Afro-house** | 118-124 | 115-128 | 59-62 | — |
| **Trap** | 140-150 | 135-155 | **70-75 (très fréquent)** | — |
| **Hip-Hop classic** | 88-98 | 85-100 | 44-49 | 176-196 |
| **Hip-Hop modern** | 140-160 | 135-170 | **70-85 (souvent double-time)** | — |
| **R&B slow** | 65-85 | 60-90 | — | 130-170 |
| **R&B mid-tempo** | 90-108 | 88-115 | 45-54 | 180-216 |
| **Disco** | 115-125 | 105-130 | 57-62 | 230-250 |
| **Pop dance** | 110-128 | 100-135 | 55-64 | 220-256 |
| **Pop chill** | 88-105 | 80-115 | 44-52 | 176-210 |
| **Rock classic** | 110-135 | 90-140 | 55-67 | — |
| **Rock alternative** | 118-135 | 110-145 | 59-67 | — |
| **Boogie / Funk** | 100-115 | 95-125 | 50-57 | — |
| **Ballade slow** | 60-80 | 55-90 | — | — |
| **Chill lounge** | 90-110 | 85-118 | 45-55 | — |

### 2.2 Utilisation

**Étape 1** : identifier le genre le plus précis possible (via Apple Music genreNames si dispo, sinon via ma connaissance)

**Étape 2** : appliquer le BPM typique du genre comme baseline

**Étape 3** : ajuster ±5 BPM selon signaux (tempo perçu, style)

**Étape 4** : si un BPM initial est fourni mais suspect, croiser avec le pattern genre

### 2.3 Cas fréquents d'erreur BPM initial

- **Deezer/Spotify retourne 160 BPM sur Hip-Hop moderne** → probablement double-time, vrai 80 BPM
- **Retourne 86 BPM sur DnB** → probablement half-time, vrai 172 BPM
- **Retourne 130+ BPM sur ballade R&B** → probablement double-time, vrai 65
- **Retourne 75 BPM sur house dance** → probablement half-time, vrai 122-125

---

## 3. Règles half-time / double-time (obligatoires)

### 3.1 Signaux double-time

Un BPM fourni est probablement **double-time** (le vrai est BPM/2) si :
- **Genre = Hip-Hop / R&B / Trap / Reggaeton** ET BPM > 140
- **Genre = DnB / Jungle** ET BPM > 300 (rare mais possible)
- Le morceau "ressent" comme mid-tempo mais le BPM est étrangement élevé

### 3.2 Signaux half-time

Un BPM fourni est probablement **half-time** (le vrai est BPM×2) si :
- **Genre = DnB / Jungle / Breakbeat** ET BPM entre 80-95
- **Genre = Techno / House** ET BPM < 65
- **Genre = Trance / Progressive** ET BPM < 65
- Le morceau "ressent" comme rapide mais le BPM est étrangement bas

### 3.3 Cas gray zone

- **Trap moderne** : peut être tagué 70-75 BPM (perçu) OU 140-150 (technique). Utiliser le **BPM technique** (140-150) car c'est ce que DJBrain va comparer aux autres tracks.
- **Reggaeton** : tagué parfois 45-49 half-time. Utiliser **90-100 réel**.

### 3.4 Règle absolue

Si je corrige un BPM initial (half-time ou double-time), **je dois le mentionner explicitement dans les notes** :
> "Correction BPM 86→172 (DnB half-time perçu). Le vrai tempo Nia Archives est 172."

---

## 4. Notes DJ substantielles (format standardisé)

### 4.1 Format obligatoire

Chaque note doit contenir **3 éléments minimum** :
1. **Contexte artiste/track** (1 ligne)
2. **Usage DJ recommandé** (moment de soirée, public, ambiance)
3. **Corrections apportées** si applicable (BPM, genre, phase)

### 4.2 Exemples good vs bad

**❌ MAUVAIS (cycle 1 approximatif)** :
```
"notes": "Bikini Bandits (7ème track du pool). Tropical/chill house Netherlands."
```

**✅ BON (V2 premium)** :
```
"notes": "Bikini Bandits collectif tropical/chill house Netherlands actif depuis 2023 (label niche). 'Stars' morceau été 2025 léger et rêveur (BPM 104 estimé low confidence). Usage recommandé : filler transition arrival→ambiance, ambiance pool party ou dîner chic. Ne PAS placer en groove/party (energy trop basse). Public 30-50 ans réceptif tropical vibes. Aucune correction BPM initiale (donnée manquante)."
```

**❌ MAUVAIS** :
```
"notes": "Standard tech house peak time."
```

**✅ BON** :
```
"notes": "Adriatique 'Closer' 2024 = melodic techno swiss référence (label X-Factor, festivals européens). Émotionnellement dense malgré peak time — signature Adriatique. Usage : peak time party sur crowd initié melodic techno (25-40 ans), pas pour anniversaire familial 60+ (trop 'sombre'). Faux positif suspected_cover Nine Inch Nails corrigé : c'est une chanson originale d'Adriatique, homonyme titre uniquement."
```

### 4.3 Ce que la note doit permettre à Jean-Sé

En lisant la note, Jean-Sé doit pouvoir :
- Décider si le track mérite d'être joué en soirée qu'il organise
- Comprendre pourquoi j'ai choisi cette phase (pas une autre)
- Savoir si isBanger était certain ou incertain
- Identifier les corrections que j'ai apportées

---

## 5. Cross-check Apple Music (quand disponible)

### 5.1 Data Apple Music à utiliser (Task #42)

Une fois Task #42 exécutée, chaque track batch_in aura :
- `appleMusic.genreNames` : ex `["Hard Rock", "Arena Rock"]`
- `appleMusic.releaseDate` : ex `"1980-07-25"`
- `appleMusic.durationInMillis` : durée précise

### 5.2 Comment croiser

**Pour genre** :
- Si Apple Music `genreNames[0]` = "Hard Rock" → je peux confiants coder `genreBDD: Rock`
- Si Apple Music dit "Progressive House" → confidence higher pour BPM 126-132
- **Warning** : parfois Apple Music met "Alternative Rock" pour de l'indie pop → mon jugement prime

**Pour releaseDate** :
- Cette date est **factuelle**, à utiliser pour peupler `releaseYear`
- Convertir `"1980-07-25"` → `releaseYear: 1980`
- Peut aussi affiner `era` (ex : `"1979-12-31"` = fin 70s décennie, pas 80s)

**Pour durationInMillis** :
- Sert principalement à distinguer edit court (2-3 min) vs extended (5-8 min)
- Impact sur cooldownDays : edit court peut être joué plus souvent

### 5.3 Priorité data

Quand data Apple Music disponible ET je suis LOW confidence sur mon estimation :
- **Apple Music prime** pour genreNames et releaseDate
- **Mon jugement prime** pour phase, isBanger, energy, danceability (Apple ne les fournit pas)

---

## 6. Warning artiste inconnu (règles strictes)

### 6.1 Comment identifier

Un artiste est "inconnu" pour moi si :
- Nom générique (ex : "Palm Brothers", "House Arrest", "Bikini Bandits", "Lumin8")
- Pas de matching évident avec un artiste célèbre
- Volume très bas sur les plateformes (deezerRank <500k)
- Nom qui ressemble à un projet DJ éphémère ou label content

### 6.2 Comportement obligatoire

Pour les artistes inconnus :
- `confidence: "low"` OBLIGATOIRE
- `isBanger: false` par défaut (jamais true sur un artiste inconnu)
- BPM estimé conservateur (baseline du genre, pas d'estimation extrême)
- Notes explicites : `"Artiste peu connu (X label niche), estimation basée genre + patterns"`
- **isFiller: true probable** (les artistes anonymes sont souvent des remplissage de catalogue)

### 6.3 Ne jamais dire

- "Signature XXX" quand je ne connais pas l'artiste
- "Public 25-40 ans" sans base
- "Referral XXX" (comparaisons hasardeuses)

---

## 7. Doctrine phases (rappel synthétique)

Cf. AHOUAI_DOCTRINE_PHASES.md pour détails complets.

### 7.1 Les 6 phases

| Phase | Rôle | BPM cible | Energy | Exemples bangers |
|---|---|---|---|---|
| **arrival** | Apéro chic, madeleine douce | 70-110 | 3.5-5 | Sade, Norah Jones |
| **ambiance** | Warm-up chaleureux | 80-115 | 5-6.5 | Marvin Gaye, Sheeran mid-tempo |
| **takeoff** | Montée, premiers pas dansants | 100-125 | 6.5-7.5 | Donna Summer, Kool & The Gang |
| **groove** | Lancé stable dancefloor | 115-130 | 7.5-8.5 | Sister Sledge, Bruno Mars |
| **party** | Peak time explosion | 120-135 | 8.5-10 | Avicii, Guetta, Justice |
| **closing** | Madeleine de Proust (feu d'artifice) | flexible | flexible | Bill Withers, Queen, Piaf, Journey |

### 7.2 Exception closing

Closing est la phase **madeleine de Proust** — le crowd veut ses souvenirs émotionnels. BPM et energy sont **flexibles**, mais phaseAlternate obligatoirement adjacent (party ou arrival selon contexte).

### 7.3 Bidirectionnalité party ⇄ closing

Ces 2 phases peuvent osciller sans transition linéaire. Impact sur phaseAlternate : party peut avoir closing comme alternate même s'ils ne sont pas "adjacents" dans l'ordre linéaire.

---

## 8. Doctrine covers (rappel V1 verrouillé)

### 8.1 Détection cover

Cover redondante identifiée si :
- suspected_cover.suspected=true dans batch_in
- OU je reconnais un tube d'un autre artiste chanté par un artiste peu connu
- OU titre standardisé (ex "Blinding Lights") par un artiste qui n'est pas l'original

### 8.2 Traitement cover redondante

```json
{
  "phase": "arrival" | "ambiance",
  "phaseAlternate": "ambiance" | "arrival",
  "suggestable": false,
  "notes": "🔴 COVER [type] du hit [original] [artiste original]. suggestable=false. Original canonique.",
  "isFiller": true,
  "isBanger": false
}
```

### 8.3 Remix officiel légitime

Si Moguai "Sympathy For The Devil" ou Deepend "September" :
- suggestable=true (remix officiel labellisé)
- Peut être party ou groove selon le remix
- isBanger éventuellement true si le remix est adopté par le crowd

### 8.4 Homonymes (faux positifs suspected_cover)

Si suspected_cover.suspected=true MAIS je sais que c'est un homonyme (ex : "Take Me" Nomadique n'a rien à voir avec Franz Ferdinand) :
- suggestable=true
- Notes obligatoires : "Suspected cover FAUX POSITIF (homonyme titre générique)"

---

## 9. Format batch_out V2 (24 champs)

### 9.1 Champs obligatoires classification (10)

```json
{
  "id": "<copie exacte>",
  "genreBDD": "<parmi 11 genres BDD>",
  "uiCategoryPrimary": "<parmi 9 UI categories>",
  "uiCategoriesSecondary": ["<0-2>"],
  "phase": "<arrival|ambiance|takeoff|groove|party|closing>",
  "phaseAlternate": "<adjacent>",
  "energy": "<int 1-10>",
  "bpm": "<int 60-220>",
  "danceability": "<float 0.0-1.0>",
  "mood": "<fun|emotional|aggressive|chill>"
}
```

### 9.2 Champs obligatoires tags (6)

```json
{
  "isBanger": "<bool>",
  "isSingalong": "<bool>",
  "isEmotional": "<bool>",
  "isCaliente": "<bool>",
  "isHardcore": "<bool>",
  "isFiller": "<bool>"
}
```

### 9.3 Champs obligatoires temporel/langue (4)

```json
{
  "era": "<50s|60s|70s|80s|90s|2000s|2010s|2020s>",
  "releaseYear": "<int 1950-2026 ou null>",
  "language": "<FR|EN|ES|PT|instrumental|autre>",
  "hasLyrics": "<bool>"
}
```

### 9.4 Champs contexte usage (5)

```json
{
  "explicit": "<bool>",
  "tags": ["<au moins 1>"],
  "partyMoment": "<warm-up|peak|closing|all>",
  "cooldownDays": "<int, défaut 14>",
  "suggestable": "<bool, true par défaut>"
}
```

### 9.5 NOUVEAUX Champs V2 documentation (4)

```json
{
  "confidence": "<high|medium|low>",
  "confidence_notes": "<courte explication du niveau>",
  "notes": "<note DJ substantielle 3 éléments minimum>",
  "justification": "<1 ligne explication choix phase + isBanger + tags principaux>"
}
```

---

## 10. Cadence premium (10 tracks/batch)

### 10.1 Ordre logique par cycle

1. **Batch de 10 tracks** dans un fichier batch_in
2. **Analyse individuelle par track** : ~2-3 min chacune
3. **Auto-évaluation qualité** avant validation (voir section 11)
4. **Livraison batch_out** dans workspace Social M
5. **Import Antigravity** vers MongoDB
6. **Review manuelle Jean-Sé** dans Monitor Curation V2 des tracks flag confidence=low

### 10.2 Rythme cible

**Par batch de 10 tracks** : 20-30 min de mon côté (au lieu de 5 min approximatif V1)

**Par cycle de 3 batches** (30 tracks) : 1h30 de session Claude focus

**Volume V1 réaliste** :
- 5 cycles × 30 tracks = 150 tracks premium en 7-8h de session Claude
- Réparti sur plusieurs sessions weekend + semaine
- Complément V1.1 pour finir la BDD après launch

### 10.3 Ce qui prend du temps supplémentaire (justifié)

- Recherche artiste (Wikipedia, MusicBrainz, réputation)
- Cross-check pattern BPM (grille section 2)
- Détection half-time/double-time
- Vérification suspected_cover réel vs homonyme
- Rédaction notes DJ substantielles
- Auto-évaluation confidence
- Cross-check Apple Music genreNames et releaseDate

---

## 11. Grille auto-évaluation qualité par track

### 11.1 Checklist avant validation

**Pour chaque track, je dois pouvoir répondre OUI à :**

- [ ] Je sais qui est cet artiste (au moins vaguement) OU j'ai marqué confidence=low
- [ ] J'ai justifié isBanger (si true) avec au moins 1 signal concret
- [ ] Mon BPM est cohérent avec le pattern genre (section 2)
- [ ] J'ai vérifié half-time/double-time si BPM suspect
- [ ] Ma phase est justifiée par BPM + energy dans la fourchette (ou exception documentée)
- [ ] phaseAlternate est adjacent (sauf party⇄closing bidirectionnel)
- [ ] uiCategoriesSecondary ne contient pas uiCategoryPrimary
- [ ] Mes notes contiennent 3 éléments (contexte + usage + corrections)
- [ ] J'ai correctement traité suspected_cover (vraie cover vs homonyme)
- [ ] Si cover redondante : suggestable=false + phase arrival/ambiance
- [ ] Confidence flag reflète honnêtement ma certitude

### 11.2 Signaux d'alerte (STOP et re-évaluer)

- Je copie-colle une note déjà utilisée sans adapter
- Je mets BPM = 120 ou 125 sans justification patterns
- Je mets danceability = 0.78 par défaut
- Je mets energy = 7 sans réflexion
- J'écris "Groove standard" sans contexte
- J'affirme "Public 25-40" sans base

**Si un de ces signaux : mettre confidence=low et flag "à revoir Jean-Sé".**

### 11.3 Cas où skip + flag Jean-Sé

Si vraiment je ne peux pas qualifier proprement (artiste totalement inconnu, contexte flou, genre incertain) :

```json
{
  "confidence": "low",
  "confidence_notes": "Artiste totalement inconnu, aucun signal contextuel. Estimation baseline genre House uniquement.",
  "notes": "⚠️ TRACK NON QUALIFIABLE PROPREMENT - review manuelle recommandée. Genre estimé House standard baseline. Toutes estimations à ±15 BPM.",
  "phase": "groove",
  "isBanger": false,
  "isFiller": true
}
```

Jean-Sé pourra filtrer ces tracks via `confidence=low AND notes contains "review manuelle"` dans Monitor Curation V2.

---

## 12. Utilisation dans le pipeline

### 12.1 Prompt batch_in à mettre à jour

Le script `scripts/generate_batches_in_v2.mjs` doit inclure dans `_instruction` :

> "Applique la DOCTRINE PREMIUM V2 (voir DOCTRINE_PREMIUM_V2.md dans le workspace Social M). Chaque track doit avoir un `confidence` flag obligatoire (high/medium/low) et des notes DJ substantielles (3 éléments minimum). Utilise le référentiel BPM par genre (section 2). Corrige half-time/double-time systématiquement. Ne jamais mettre isBanger=true sur un artiste inconnu. Auto-évaluation qualité avant validation."

### 12.2 Format batch_out à mettre à jour

Le script `scripts/import_batches_out.mjs` doit accepter les nouveaux champs :
- `confidence` (string enum: high|medium|low)
- `confidence_notes` (string)

Ajouter au schema Track.js :
```javascript
confidence: { type: String, enum: ['high', 'medium', 'low', null], default: null },
confidence_notes: { type: String, default: null }
```

Index MongoDB pour Jean-Sé review manuelle :
```javascript
TrackSchema.index({ confidence: 1, classifiedBy: 1 });
```

### 12.3 UI Monitor Curation V2

Ajouter un filtre visuel :
- Badge orange sur les tracks confidence=medium
- Badge rouge sur les tracks confidence=low
- Colonne "confidence" dans la table
- Filtre "Show only low confidence" pour review Jean-Sé prioritaire

---

## 13. Récapitulatif — ce qui change vs V1

| Aspect | V1 (14/07 matin) | V2 (14/07 soir) |
|---|---|---|
| Tracks par batch | 20 | 10 |
| Temps par track | ~30 sec | ~2-3 min |
| BPM sur artiste inconnu | 120 par défaut | Pattern genre + confidence=low |
| Danceability par défaut | 0.78 | Réel par track (pas de défaut) |
| Notes DJ | 1 ligne "Groove standard" | 3 éléments substantiels |
| Confidence flag | Absent | Obligatoire |
| isBanger sur inconnu | Parfois true | Toujours false + confidence=low |
| Correction BPM | Occasionnelle | Systématique half-time/double-time |
| Cross-check Apple Music | Non | Oui (genreNames, releaseDate) |
| Auto-évaluation | Non | Checklist 11 items par track |
| Volume V1 target | 500 tracks | 150-200 tracks premium |

---

## 14. Prochaine étape

1. **Validation Jean-Sé** (à froid) — relire ce doc et challenger
2. **Mise à jour scripts** :
   - `generate_batches_in_v2.mjs` avec référence à cette doctrine
   - `import_batches_out.mjs` avec accept des nouveaux champs
   - `Track.js` avec champs confidence + index
3. **Reset cycle 1** — les 100 tracks batch_out_007-011 retournent au pool candidates
4. **Task #42 Apple Music IDs** — en parallèle pour enrichir batch_in avec genreNames + releaseDate
5. **Cycle 2 premium** — 30 tracks (3 batches × 10) avec doctrine V2 appliquée
6. **Review Jean-Sé** — validation qualité sur cycle 2 avant scale

---

*Doctrine V2 rédigée par Claude, session Cowork Jean-Sé du 14 juillet 2026 en fin de journée.*
*À valider à froid par Jean-Sé avant application au cycle 2.*
*Prochain review : après cycle 2 (~30 tracks) pour ajuster si nécessaire.*
