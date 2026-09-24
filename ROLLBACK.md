# ROLLBACK.md — Procédures de retour arrière

> Public : Stan (Claude de Daphné), Antigravity, ChatGPT, moi (Claude Jean-Sé), et Jean-Sé.
> À consulter en cas de : régression suspectée, prod cassée, doute sur un push récent.

---

## 1. Tags "safe point" existants

Points de sauvegarde permanents sur ce repo :

| Tag | Date | Contenu clé |
|---|---|---|
| `v1-safe-2026-09-24` | 24 sept 2026 | Profile persist A+B, Cercle photos SSO, dedup renforcée, HEIC guard, cropper, action sheet, STAN_ONBOARDING.md. Point stable avant refonte iOS Antigravity + travaux Stan/Daphné sur guest web. |

Voir tous les tags :

```bash
git tag -l
```

Voir le contenu d'un tag :

```bash
git show v1-safe-2026-09-24
```

## 2. Rollback léger — Render dashboard (recommandé en urgence)

**Le plus rapide, aucun risque sur git.**

1. https://dashboard.render.com → service `socialmix-relay`
2. Onglet **Deploys**
3. Sélectionne le dernier deploy vert connu
4. **⋯** → **Rollback to this deploy**
5. Attends ~2 min → prod restaurée

Ton repo git reste avec le code cassé (à fixer proprement après). Mais la prod est déjà safe.

## 3. Rollback git — revenir sur un tag

**Option A — Créer une branche de secours depuis le tag (safe, non destructif)**

```bash
git fetch --tags
git checkout -b rollback/from-{TAG} {TAG}
# résous ce que tu veux garder
git push origin rollback/from-{TAG}
# ouvre une PR vers main pour merge propre
```

**Option B — Reset main sur le tag (DANGEREUX, écrase les commits post-tag)**

```bash
# Uniquement si tu es sûr de ce que tu fais + tous les commits post-tag sont à jeter
git checkout main
git reset --hard {TAG}
git push --force origin main
```

⚠️ **Ne jamais faire l'option B sans prévenir Jean-Sé + les autres agents actifs** (Stan, Antigravity, moi). Un force push écrase leur travail parallèle.

## 4. Revert d'un commit précis

Si tu sais quel commit a cassé la prod :

```bash
git revert <sha_commit_à_annuler>
git push origin main
```

Git crée un nouveau commit qui annule les changements du commit incriminé. Non-destructif, historique préservé. **C'est la méthode par défaut** pour undo un push spécifique.

## 5. Créer un nouveau tag "safe point"

Après une session productive stable, capture l'état :

```bash
git tag -a v1-safe-YYYY-MM-DD -m "Contexte : ce qui vient d'être fait, ce qui marche"
git push origin v1-safe-YYYY-MM-DD
```

Convention de nommage : `v1-safe-YYYY-MM-DD` ou `v1-{feature}-done`.

## 6. Règles pour les agents (Stan / Antigravity / autres)

1. **Ne JAMAIS force push (`git push --force`)** sans validation explicite de Jean-Sé
2. **Ne JAMAIS supprimer un tag** (`git tag -d`, `git push --delete`)
3. **En cas de doute sur un push** → tag l'état actuel avant de push, ainsi Jean-Sé peut revert sur le tag
4. **Si tu vois `remote: rejected` (non-fast-forward)** → un autre agent a push entre-temps, fais `git pull --rebase` puis retry, JAMAIS `--force`
5. **Après un push qui touche à server.js / models / routes** → notifie dans le canal WhatsApp AhOuai Dev Log
