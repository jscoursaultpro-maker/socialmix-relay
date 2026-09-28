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
http://127.0.0.1:3000/spike/spotify.html        ← dev local
https://api.ahouai.com/spike/spotify.html        ← prod/test téléphone
```

Ajouter dans **Settings → Redirect URIs** du dashboard Spotify.

⚠️ `localhost` est interdit — utiliser `127.0.0.1` (IP littérale).

## Lancement local

```bash
cd relay-server
npm start
# Ouvrir : http://127.0.0.1:3000/spike/spotify.html
```

## Test téléphone (Chrome Android)

1. Pousser la branche `spike/spotify-web` → Render auto-deploy
2. Ouvrir `https://api.ahouai.com/spike/spotify.html` dans Chrome Android
3. Assurer que l'app Spotify est ouverte en arrière-plan (lancer un titre 1s puis pause)
4. Se connecter avec le Client ID et son compte Spotify Premium
5. Sélectionner le device téléphone dans la liste
6. Tester Play A, Queue B, Next, Pause/Resume

## Protocole de test (9 étapes)

1. Connexion PKCE OK sur Chrome Android, product=premium affiché
2. Device téléphone visible
3. Play A démarre sur le téléphone, Chrome reste devant
4. Queue B pendant A → fin de A, B démarre seul
5. Next pendant B → transition immédiate ; file vide → AutoPlay détecté ?
6. Écran verrouillé 2 min → musique continue ; au déverrouillage état resync
7. Chrome en arrière-plan 2 min → rappelé → état resync
8. Chrome desktop, device = téléphone → Play A joue sur le téléphone
9. Bonus desktop : "Jouer dans ce navigateur" → Chrome joue A via Web Playback SDK

## Architecture

```
spike/spotify.html       ← page unique, 0 dépendances
├── PKCE auth            ← Authorization Code + PKCE, 100% navigateur
├── Devices              ← GET /me/player/devices
├── Playback             ← PUT /me/player/play, POST /me/player/queue, POST /me/player/next
├── Probing              ← GET /me/player (smart timing, pas de polling fixe)
├── AutoPlay detection   ← Set<URI> des tracks mises en queue vs item.uri courant
├── Wake Lock            ← navigator.wakeLock.request('screen')
├── Web Playback SDK     ← bonus desktop uniquement (masqué sur mobile)
└── Journal API          ← horodaté, copiable, compteur d'appels
```

## Contraintes

- **Jetable** : aucune intégration relay-server, socket, MongoDB, DJ Brain
- **Pas de secret** dans le code — Client ID collé par l'utilisateur
- **Tokens en sessionStorage** uniquement — refresh auto 60s avant expiration
- **Sonde intelligente** : aucun polling fixe, ~4-6 appels/piste, rate-limit 429 géré
