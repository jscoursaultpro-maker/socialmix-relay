# AhOuai Relay Server — Integration Tests

Tests d'intégration Socket.IO + HTTP pour le relay-server AhOuai.  
Utilisent **Node.js 20+ native test runner** (`node:test`) — aucune dépendance externe requise.

## Prérequis

### 1. MongoDB Atlas de test (OBLIGATOIRE)

> [!CAUTION]
> **NE JAMAIS** utiliser `MONGODB_URI` (production) pour les tests.  
> Créer un cluster dédié sur MongoDB Atlas (Free Tier M0 suffit).

```bash
# Créer un utilisateur test dans Atlas → Network Access → IP Whitelist (0.0.0.0/0 pour CI)
# Copier la connection string dans .env.test (jamais en dur dans le code)
```

### 2. Fichier `.env.test` (gitignored)

```env
# Remplacer <USER>, <PASSWORD>, <CLUSTER> par les valeurs de ton Atlas test cluster
MONGODB_URI_TEST=<YOUR_ATLAS_TEST_CONNECTION_STRING>
```

### 3. `socket.io-client` (déjà installé en devDependencies)

```bash
npm install  # déjà fait si vous avez cloné le repo
```

---

## Lancer les tests

```bash
# Avec le fichier .env.test
MONGODB_URI_TEST=mongodb+srv://... npm run test:integration

# Ou avec source .env.test
export $(grep -v '^#' .env.test | xargs) && npm run test:integration

# Avec timeout étendu (Atlas lent en free tier)
MONGODB_URI_TEST=mongodb+srv://... node --test --test-timeout=30000 tests/integration/**/*.test.js
```

---

## Structure

```
tests/
├── README.md                          ← ce fichier
├── helpers/
│   ├── server-process.js              ← spawn/kill du serveur sur port éphémère
│   ├── client.js                      ← wrapper socket.io-client (host + guest)
│   └── mongo.js                       ← findParty, cleanupParties, waitForPartyCondition
└── integration/
    ├── party-lifecycle.test.js        ← startParty → track → endParty → archive
    ├── party-collision.test.js        ← fix #69: code collision guard
    ├── party-multi-secret.test.js     ← fix #79: GET /api/host/parties isolation
    └── write-through.test.js          ← persistence immédiate (fix eca11c2 + 1d27287)
```

---

## Détail des suites

| Fichier | Tests | Ce qu'il valide |
|---|---|---|
| `party-lifecycle.test.js` | 4 | Cycle de vie complet : création, track, fin, archivage |
| `party-collision.test.js` | 3 | Code collision → `PARTY_CODE_ACTIVE` + données intactes |
| `party-multi-secret.test.js` | 5 | Isolation hostSecret, pas de fuite cross-secret |
| `write-through.test.js` | 6 | Écriture immédiate en DB pour chaque mutation |

**Total : 18 tests**, durée estimée < 30s sur Atlas Free Tier (< 10s sur Atlas Dedicated).

---

## Comment fonctionnent les tests

1. `server-process.js` spawn `server.js` comme process enfant sur un **port éphémère** aléatoire
2. `MONGODB_URI` est remplacé par `MONGODB_URI_TEST` dans l'env du process enfant
3. Les sockets se connectent à `http://127.0.0.1:{PORT}` via `socket.io-client`
4. `mongo.js` se connecte **indépendamment** à `MONGODB_URI_TEST` pour vérifier les writes en DB
5. Chaque suite fait un **cleanup** complet avant et après (idempotent)

---

## Variables d'environnement

| Variable | Requis | Description |
|---|---|---|
| `MONGODB_URI_TEST` | ✅ Obligatoire | URI Atlas de test (jamais la prod) |
| `PORT` | Auto-généré | Port éphémère (ne pas forcer) |

---

## Ajouter un nouveau test

```javascript
// tests/integration/my-feature.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/server-process.js';
import { createHostSocket, connected, disconnect, startParty } from '../helpers/client.js';
import { connectTestDB, disconnectTestDB, cleanupParties } from '../helpers/mongo.js';

const CODE = 'T_MYFEAT';

describe('my-feature', async () => {
  let serverCtx;
  before(async () => {
    await connectTestDB();
    await cleanupParties(CODE);
    serverCtx = await startServer();
  });
  after(async () => {
    await serverCtx?.kill();
    await cleanupParties(CODE);
    await disconnectTestDB();
  });

  it('my test', async () => {
    // ... 
  });
});
```

---

## CI/CD (GitHub Actions)

```yaml
# .github/workflows/test.yml
- name: Integration tests
  env:
    MONGODB_URI_TEST: ${{ secrets.MONGODB_URI_TEST }}
  run: npm run test:integration
```

Ajouter `MONGODB_URI_TEST` dans les **GitHub Secrets** du repo.
