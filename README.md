# curation-data — branche de données du pipeline de curation AhOuai

Cette branche ne contient **aucun code** et ne déclenche aucun déploiement. Elle sert de boîte aux lettres :

| Dossier | Écrit par | Contenu |
|---|---|---|
| `inbox/` | GitHub Action `curation-export` | tracks à qualifier, identité vérifiée sur Deezer |
| `outbox/` | session Claude planifiée | classifications (25 champs + confidence) |
| `sidelined/` | `curation-export` | tracks écartées (mismatch / introuvables Deezer) → relecture |
| `review/` | GitHub Action `curation-import` | rapport d'import : appliquées / à relire / invalides |
| `logs/` | session Claude | journal court de chaque run |
| `state.json` | export + import | ids en attente / importés (idempotence) |

Uniquement des métadonnées de titres : jamais de données utilisateurs.
