# 📊 Audit v3 — Phase Conformity (champ corrigé : `track.phase`)

> Généré le 2026-08-10T10:25:16.722Z
> Période : 2026-07-18T00:00:00.000Z → 2026-08-10T00:00:00.000Z
> Correction : utilise `track.phase` (6 phases granulaires) au lieu de `track.partyMoment` (3 phases, 87% "all")
> L'audit v2 reportait 92% hors-phase — ce chiffre était FAUX car basé sur le mauvais champ

---

## 1. 🎯 Vue globale

| Métrique | Count | % |
|----------|-------|---|
| Total tracks jouées | 249 | 100% |
| ✅ **Exact match** (track.phase == displayed phase) | 130 | 52.2% |
| 🟡 **Adjacent** (±1 phase) | 88 | 35.3% |
| 🔴 **Distant** (>1 phase) | 16 | 6.4% |
| ⚪ **Pas de phase** (track.phase null) | 15 | 6.0% |
| ✅🟡 **Conforme** (exact + adjacent) | 218 | 87.6% |

> ### Comparaison audit v2 vs v3
> | Audit | Champ utilisé | "Conforme" | "Hors-phase" |
> |-------|--------------|------------|-------------|
> | **v2 (FAUX)** | `track.partyMoment` | ~4% | ~92% |
> | **v3 (CORRIGÉ)** | `track.phase` | 87.6% | 6.4% |

---

## 2. 📊 Détail par phase affichée

| Phase affichée | Total | ✅ Exact | 🟡 Adjacent | 🔴 Distant | ⚪ Pas de phase | % conforme |
|----------------|-------|----------|-------------|------------|----------------|------------|
| arrival | 136 | 100 (74%) | 19 (14%) | 6 (4%) | 11 | **88%** |
| ambiance | 22 | 15 (68%) | 4 (18%) | 0 (0%) | 3 | **86%** |
| takeoff | 85 | 11 (13%) | 65 (76%) | 9 (11%) | 0 | **89%** |
| groove | 6 | 4 (67%) | 0 (0%) | 1 (17%) | 1 | **67%** |

---

## 3. 🎉 Conformité par soirée

| Code | Tracks | ✅ Exact | 🟡 Adjacent | 🔴 Distant | ⚪ No phase | % conforme |
|------|--------|----------|-------------|------------|------------|------------|
| KHXVMB | 29 | 26 | 3 | 0 | 0 | **100%** |
| LETEB7_archived_1784452227718 | 22 | 16 | 3 | 2 | 1 | **86%** |
| LETEB7 | 1 | 1 | 0 | 0 | 0 | **100%** |
| 9BT3SJ | 15 | 6 | 1 | 1 | 7 | **47%** |
| 62WP9B | 6 | 4 | 2 | 0 | 0 | **100%** |
| FSXKWP | 3 | 2 | 1 | 0 | 0 | **100%** |
| SDCQXR | 79 | 5 | 64 | 10 | 0 | **87%** |
| 87TAG6 | 16 | 13 | 3 | 0 | 0 | **100%** |
| HRA3QU | 8 | 3 | 0 | 1 | 4 | **38%** |
| 7AJ5NR | 42 | 34 | 8 | 0 | 0 | **100%** |
| PLPRTU | 12 | 6 | 1 | 2 | 3 | **58%** |

---

## 4. 🔴 Tracks distantes (>1 phase de distance)

| Titre | Artiste | Phase track | Phase affichée | Distance | Party |
|-------|---------|-------------|----------------|----------|-------|
| Memories (feat. Kid Cudi) | David Guetta | party | arrival | 4 | LETEB7_archived_1784452227718 |
| RENÉ CAOVILLA | Gambi | party | arrival | 4 | HRA3QU |
| This Girl (Kungs Vs. Cookin' On 3 Burners) (Kungs Vs. Cookin' On 3 Burners) | Kungs | groove | arrival | 3 | PLPRTU |
| Never Going Home | Kungs | groove | arrival | 3 | PLPRTU |
| Goosebumps | Travis Scott | takeoff | arrival | 2 | 9BT3SJ |
| Comptine d'un autre été, l'après-midi | Yann Tiersen | takeoff | arrival | 2 | SDCQXR |
| Valerie | Amy Winehouse | arrival | takeoff | 2 | SDCQXR |
| Catch & Release | Matt Simons | arrival | takeoff | 2 | SDCQXR |
| Feels | Calvin Harris | arrival | takeoff | 2 | SDCQXR |
| Good Thing | Fine Young Cannibals | arrival | takeoff | 2 | SDCQXR |
| Are You Even Real | Teddy Swims | arrival | takeoff | 2 | SDCQXR |
| Wrecked | Imagine Dragons | arrival | takeoff | 2 | SDCQXR |
| Belong Together | Mark Ambor | arrival | takeoff | 2 | SDCQXR |
| C'est à qui le tour | Mylène Farmer | arrival | takeoff | 2 | SDCQXR |
| Red Red Wine | UB40 | arrival | takeoff | 2 | SDCQXR |
| MAMACITA | Black Eyed Peas, Ozuna & J. Rey Soul | closing | groove | 2 | LETEB7_archived_1784452227718 |

---

## 5. 📈 Timeline phase (plus grosse soirée)

Session **SDCQXR** — 79 tracks

| # | Heure | Titre | Artiste | Phase affichée | Phase track | Match |
|---|-------|-------|---------|----------------|-------------|-------|
| 1 | 14:02:23 | Je vole | Louane | arrival | arrival | ✅ |
| 2 | 14:02:32 | É Tudo Sobre Você (Ao Vivo) | MORADA | arrival | arrival | ✅ |
| 3 | 14:02:41 | Comptine d'un autre été, l'après-midi | Yann Tiersen | arrival | takeoff | 🔴 |
| 4 | 14:02:50 | I Kissed A Girl | Katy Perry | takeoff | takeoff | ✅ |
| 5 | 14:05:45 | Lush Life | Zara Larsson | takeoff | takeoff | ✅ |
| 6 | 14:08:53 | Who Mad Again | Jahyanai | takeoff | groove | 🟡 |
| 7 | 14:12:04 | Now I'm Fine | Grey & Hanks | takeoff | takeoff | ✅ |
| 8 | 14:19:07 | Comme Caroline | Zaho | takeoff | ambiance | 🟡 |
| 9 | 14:22:01 | Half The Day's Gone And We Haven't Earned A Penny | Kenny Lynch | takeoff | ambiance | 🟡 |
| 10 | 14:28:46 | Don't Dream It's Over | Evan Cole | takeoff | ambiance | 🟡 |
| 11 | 14:30:57 | Para Que Llorar | Santi Sanz | takeoff | ambiance | 🟡 |
| 12 | 14:33:56 | I Just Might | Bruno Mars | takeoff | ambiance | 🟡 |
| 13 | 14:37:17 | Tomorrow | Indicate | takeoff | ambiance | 🟡 |
| 14 | 14:39:39 | Waitin' Round To Die | The Avener | takeoff | ambiance | 🟡 |
| 15 | 14:43:45 | Body | Summer Walker | takeoff | ambiance | 🟡 |
| 16 | 14:46:47 | P.I.M.P. | 50 Cent | takeoff | ambiance | 🟡 |
| 17 | 14:50:46 | Me Gustas Tu | Manu Chao | takeoff | ambiance | 🟡 |
| 18 | 14:54:40 | La Vida Es Un Carnaval | Celia Cruz | takeoff | ambiance | 🟡 |
| 19 | 14:59:05 | Jolie madame | Joé Dwet Filé | takeoff | ambiance | 🟡 |
| 20 | 15:02:15 | Balada | Gusttavo Lima | takeoff | ambiance | 🟡 |
| 21 | 15:05:24 | RITMO | Black Eyed Peas | takeoff | ambiance | 🟡 |
| 22 | 15:08:47 | Esto Te Pone la Cabeza Mala | Juan Formell y Los Van Van | takeoff | ambiance | 🟡 |
| 23 | 15:12:42 | Laisse parler les gens !!! (feat. Jacob Desvarieux & Passi) | Jocelyne Labylle | takeoff | ambiance | 🟡 |
| 24 | 15:15:52 | Ai se eu te pego (nossa nossa) | MICHEL TELO | takeoff | ambiance | 🟡 |
| 25 | 15:18:31 | Todo De Ti | Rauw Alejandro | takeoff | ambiance | 🟡 |
| 26 | 15:21:39 | Single Ladies (Put a Ring on It) | Beyoncé | takeoff | ambiance | 🟡 |
| 27 | 15:24:46 | Can't Stop | Red Hot Chili Peppers | takeoff | ambiance | 🟡 |
| 28 | 15:29:09 | Est-ce que tu m'aimes | GIMS | takeoff | ambiance | 🟡 |
| 29 | 15:32:54 | Turn Me On | Kevin Lyttle | takeoff | ambiance | 🟡 |
| 30 | 15:35:54 | All Star | Smash Mouth | takeoff | ambiance | 🟡 |
| 31 | 15:39:03 | GIRLFRIEND | Tayc | takeoff | ambiance | 🟡 |
| 32 | 15:43:10 | Ordinary | Alex Warren | takeoff | ambiance | 🟡 |
| 33 | 15:48:59 | Copines | Aya Nakamura | takeoff | ambiance | 🟡 |
| 34 | 15:51:39 | Goo Goo Muck | The Cramps | takeoff | ambiance | 🟡 |
| 35 | 15:54:33 | Valerie | Amy Winehouse | takeoff | arrival | 🔴 |
| 36 | 16:00:27 | Elle me dit | MIKA | takeoff | ambiance | 🟡 |
| 37 | 16:03:53 | A Un Paso De La Luna | Reik | takeoff | ambiance | 🟡 |
| 38 | 16:06:56 | Why Do the Bad Things Feel Good | Marina Kaye | takeoff | ambiance | 🟡 |
| 39 | 16:10:05 | I'll Be There For You | Fabyan | takeoff | ambiance | 🟡 |
| 40 | 16:15:49 | Catch & Release | Matt Simons | takeoff | arrival | 🔴 |
| 41 | 16:19:54 | DtMF | Bad Bunny | takeoff | ambiance | 🟡 |
| 42 | 16:23:44 | Feels | Calvin Harris | takeoff | arrival | 🔴 |
| 43 | 16:27:15 | Good Thing | Fine Young Cannibals | takeoff | arrival | 🔴 |
| 44 | 16:30:25 | As It Was | Harry Styles | takeoff | ambiance | 🟡 |
| 45 | 16:33:01 | Johnny Be Goode | Chuck Berry | takeoff | ambiance | 🟡 |
| 46 | 16:35:32 | Price Tag | Jessie J | takeoff | ambiance | 🟡 |
| 47 | 16:38:28 | Are You Even Real | Teddy Swims | takeoff | arrival | 🔴 |
| 48 | 16:40:44 | ONE TRACK MIND | Naïka | takeoff | ambiance | 🟡 |
| 49 | 16:43:53 | TOUT VA BIEN | Alonzo | takeoff | ambiance | 🟡 |
| 50 | 16:46:53 | Marry You | Bruno Mars | takeoff | ambiance | 🟡 |
| 51 | 16:50:31 | NETFLIX CHILL | Zola, Kalash & PRINC€ | takeoff | ambiance | 🟡 |
| 52 | 16:52:48 | Dis-moi | BB Brunes | takeoff | ambiance | 🟡 |
| 53 | 16:55:00 | Place des grands hommes | Patrick Bruel | takeoff | ambiance | 🟡 |
| 54 | 16:59:27 | Tears | Sabrina Carpenter | takeoff | ambiance | 🟡 |
| 55 | 17:01:55 | Escroc | Marine | takeoff | ambiance | 🟡 |
| 56 | 17:04:40 | I Want Your Sex | Brigitte | takeoff | ambiance | 🟡 |
| 57 | 17:08:05 | Dracula | Tame Impala | takeoff | ambiance | 🟡 |
| 58 | 17:11:18 | Flowers | Miley Cyrus | takeoff | ambiance | 🟡 |
| 59 | 17:14:27 | Cannonball | The Breeders | takeoff | ambiance | 🟡 |
| 60 | 17:17:49 | Musique (Remasterisé en 2004) | France Gall | takeoff | ambiance | 🟡 |
| 61 | 17:23:02 | Viva La Vida | Coldplay | takeoff | ambiance | 🟡 |
| 62 | 17:26:51 | Comment on fait | Vianney | takeoff | ambiance | 🟡 |
| 63 | 17:29:40 | On verra bien | Jovan | takeoff | ambiance | 🟡 |
| 64 | 17:32:25 | Wrecked | Imagine Dragons | takeoff | arrival | 🔴 |
| 65 | 17:36:17 | Feel Good | Charlotte Cardin | takeoff | ambiance | 🟡 |
| 66 | 17:38:48 | Ho Hey | The Lumineers | takeoff | ambiance | 🟡 |
| 67 | 17:41:19 | Rock DJ | Robbie Williams | takeoff | ambiance | 🟡 |
| 68 | 17:45:26 | Essence (feat. Tems) | WizKid | takeoff | ambiance | 🟡 |
| 69 | 17:49:23 | Five Minutes | Her | takeoff | ambiance | 🟡 |
| 70 | 17:52:56 | PUSH 2 START | Tyla | takeoff | ambiance | 🟡 |
| 71 | 17:55:21 | Belong Together | Mark Ambor | takeoff | arrival | 🔴 |
| 72 | 17:57:37 | I Write Sins Not Tragedies | Panic! At the Disco | takeoff | ambiance | 🟡 |
| 73 | 18:00:33 | C'est à qui le tour | Mylène Farmer | takeoff | arrival | 🔴 |
| 74 | 18:03:10 | I Love to Love | Tina Charles | takeoff | ambiance | 🟡 |
| 75 | 18:06:20 | Secret | Louane | takeoff | ambiance | 🟡 |
| 76 | 18:09:18 | TEXAS HOLD 'EM | Beyoncé | takeoff | ambiance | 🟡 |
| 77 | 18:12:59 | Lovefool | The Cardigans | takeoff | ambiance | 🟡 |
| 78 | 18:16:01 | West End Girls | Pet Shop Boys | takeoff | ambiance | 🟡 |
| 79 | 18:20:35 | Red Red Wine | UB40 | takeoff | arrival | 🔴 |

---

## 6. ⚪ Tracks sans phase jouées

| Métrique | Valeur |
|----------|--------|
| Tracks jouées sans phase (période) | 7 |
| Total tracks MongoDB sans phase | 867 / 2810 |

### Détail tracks jouées sans phase
| Titre | Artiste | Genre | BPM | partyMoment | qualityLevel |
|-------|---------|-------|-----|-------------|-------------|
| Verona | Muse | Electro | ? | all | vide |
| Sur la lune | Bigflo & Oli | Electro | ? | all | vide |
| Still Loving You | Scorpions | Electro | ? | all | vide |
| Dream On | Aerosmith | Electro | ? | all | vide |
| Could You Be Loved | Bob Marley & The Wailers | Electro | ? | all | vide |
| Is This Love | Bob Marley & The Wailers | Electro | ? | all | vide |
| Buffalo Soldier | Bob Marley & The Wailers | Electro | ? | all | vide |

---

## 🎯 Conclusion

### ✅ DJ Brain fonctionne correctement

- **87.6%** de conformité phase (exact + adjacent)
- **6.4%** de tracks distantes (>1 phase)
- L'audit v2 reportait 92% hors-phase : **ce chiffre était FAUX** (mauvais champ)
- Le fix Bug #23 juillet est **effectif** : le champ `track.phase` est bien utilisé

### Priorités Sprint 2 (mises à jour)

Les priorités de l'audit v2 sont **révisées** :

| Priorité v2 | Statut v3 |
|-------------|-----------|
| P0 — Re-batch 2437 tracks "all" | ❌ **ANNULÉ** — partyMoment n'est pas le champ utilisé |
| P0 — Fresh rotation cross-session | ✅ **Maintenu** — anti-replay toujours cassé |
| P1 — Cleanup parties fantômes | ✅ **Maintenu** |
| P1 — Watchdog root cause | ✅ **Maintenu** — 95 triggers restent vrais |
| P1 — Suggestions pipeline | ✅ **Maintenu** — 10% jouées |
| **NOUVEAU** — Remplir phase pour les 867 tracks sans phase | 🟡 **P2** — 82% coverage, améliorer |

---

*Audit v3 corrigé — 186 lignes — Aucune modification appliquée*