# Spike Spotify Web API — Pilotage Spotify Connect depuis un navigateur

## Objectif

Prouver que la Web API Spotify (POST /me/player/queue, PUT /me/player/play) peut piloter l'app Spotify installée sur un téléphone Android **depuis Chrome Android** (télécommande navigateur → app), et en bonus qu'un Chrome desktop peut jouer directement via le Web Playback SDK.

## Pré-requis

1. **Compte Spotify Premium** (gratuit ne supporte pas le contrôle de lecture)
2. **App Spotify** installée et ouverte sur le téléphone cible
3. **Spotify Developer Dashboard** : https://developer.spotify.com/dashboard
   - Créer une app ou utiliser l'existante AhOuai
   - Client ID : celui du dashboard (collé dans la page au login)

## URIs à déclarer dans le Dashboard Spotify

```
http://127.0.0.1:3069/spike/spotify.html        ← dev local (port 3069)
https://<tunnel>.trycloudflare.com/spike/spotify.html  ← test téléphone via tunnel
```

Ajouter dans **Settings → Redirect URIs** du dashboard Spotify.

⚠️ `localhost` est interdit — utiliser `127.0.0.1` (IP littérale).

## Lancement local

```bash
cd relay-server
npm start
# Ouvrir : http://127.0.0.1:3069/spike/spotify.html
```

## Test téléphone (Chrome Android)

```bash
# Option A : cloudflared (gratuit, pas de compte)
npx cloudflared tunnel --url http://127.0.0.1:3069

# Option B : ngrok
ngrok http 3069
```

1. Copier l'URL HTTPS du tunnel
2. Ajouter cette URL comme redirect URI dans le dashboard Spotify
3. Ouvrir `https://<tunnel>/spike/spotify.html` dans Chrome Android
4. Assurer que l'app Spotify est ouverte en arrière-plan (lancer un titre 1s puis pause)
5. Se connecter avec le Client ID et son compte Spotify Premium

## Boutons de test

### Rangée 1 — Basiques
- **Play A** : PUT /me/player/play { uris:[A] } — lecture simple, pas de contexte
- **Queue B** : POST /me/player/queue?uri=B — ajoute B à la file
- **Next** : POST /me/player/next — passe au titre suivant
- **Pause/Resume** : alterne pause et lecture
- **Voir la file** : GET /me/player/queue — affiche les 5 premiers titres en file

### Rangée 2 — Diagnostics avancés
- **Play A+B (uris)** : PUT /me/player/play { uris:[A, B] } — crée un contexte implicite avec les deux titres, B devrait enchaîner automatiquement
- **Reprendre + insérer C** : lit l'état courant (item.uri, progress_ms), puis PUT /me/player/play { uris:[current, C], position_ms: progress } — le titre courant reprend à la même position, C apparaît en file
- **Séquence iOS** : reproduit exactement le flow de SpotifyService.swift (voir Partie 1 audit)

## Architecture

```
spike/spotify.html       ← page unique, 0 dépendances
├── PKCE auth            ← Authorization Code + PKCE, 100% navigateur
├── Devices              ← GET /me/player/devices
├── Playback             ← PUT /me/player/play, POST /me/player/queue, POST /me/player/next
├── Play A+B (uris)      ← PUT /me/player/play { uris:[A, B] }
├── Reprendre + insérer  ← re-play with position_ms + new queue
├── Séquence iOS         ← reproduit SpotifyService.swift flow exact
├── Probing              ← GET /me/player (smart timing, pas de polling fixe)
├── Queue inspection     ← GET /me/player/queue (après chaque queue + bouton manuel)
├── AutoPlay detection   ← Set<URI> des tracks mises en queue vs item.uri courant
├── Track Relinking      ← item.linked_from.uri vérifié contre notre Set
├── Wake Lock            ← navigator.wakeLock.request('screen')
├── Web Playback SDK     ← bonus desktop uniquement (masqué sur mobile)
└── Journal API          ← horodaté, copiable, compteur d'appels
```

## Contraintes

- **Jetable** : aucune intégration relay-server, socket, MongoDB, DJ Brain
- **Pas de secret** dans le code — Client ID collé par l'utilisateur
- **Tokens en sessionStorage** uniquement — refresh auto 60s avant expiration
- **Sonde intelligente** : aucun polling fixe, ~4-6 appels/piste, rate-limit 429 géré
