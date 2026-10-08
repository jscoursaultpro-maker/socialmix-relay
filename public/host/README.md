# Cockpit Hôte Web — Phase 1

> Branche : `feature/host-web` | Port local : **3069** | Ne pas merger/déployer en prod.

## Contexte

Basé sur les conclusions du spike `relay-server/public/spike/spotify.html` :
- PKCE auth ✅ | Premium détecté ✅ | device Connect ✅ | play/queue/next ✅
- Séquence iOS validée (T-45s, pas de `device_id` en query param)

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `public/host/index.html` | 3 écrans : formulaire, device picker, now playing |
| `public/host/host.js` | Logique complète (SSO, socket, Spotify, djbrain-lite) |
| `public/host/host.css` | Thème dark néon (cyan/rose) |
| `public/shared/spotify-service.js` | Service Spotify Web API partagé (spike + cockpit) |
| `routes/djbrain-lite.js` | Sélection titres provisoire (**PROVISOIRE** — contrat stable) |

### Modification server.js (diff limité)
```diff
+import djbrainLiteRouter from './routes/djbrain-lite.js';
+app.use('/api/djbrain-lite', djbrainLiteRouter);
```

## Lancement local

```bash
cd relay-server
npm start
# Ouvrir : http://127.0.0.1:3069/host/
```

## Test téléphone (HTTPS requis par Spotify PKCE)

```bash
# Option A : cloudflared (gratuit, pas de compte)
npx cloudflared tunnel --url http://127.0.0.1:3069

# Option B : ngrok
ngrok http 3069
```

1. Copier l'URL HTTPS du tunnel
2. L'ajouter comme **Redirect URI** dans [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   → `https://<tunnel>/host/`
3. Ouvrir `https://<tunnel>/host/` dans Chrome Android
4. Se connecter avec son compte ahouai.com (Google OAuth)

## Ce qui est PROVISOIRE

| Composant | Statut | Remplacement prévu |
|---|---|---|
| `djbrain-lite.js` | ⚠️ **PROVISOIRE** | AhOuai serveur complet |
| Sélection phase | Filtre `arrival` statique | Phases dynamiques par ambiance |
| Code soirée | Généré côté client | Généré côté serveur avec unicité garantie |
| Upload cover | FileReader local (pas Cloudinary) | Upload Cloudinary (pattern guest) |

> **Contrat stable djbrain-lite** : `[{trackId, title, artist, spotifyUri, durationMs}]`
> — l'API peut être remplacée par AhOuai serveur sans changer host.js.

## Protocole de test manuel

```
1. Ouvrir http://127.0.0.1:3069/host/?debug=1 (active le panneau log)
2. Se connecter → profil affiché, nom soirée pré-rempli
3. Cliquer "Connecter Spotify" → PKCE redirect → retour → Premium ✓
4. Cliquer "Lancer la soirée" → code généré → device Spotify détecté
5. Titre 1 joue → log "▶ PLAY …"
6. Attendre T-45s → log "📋 Queued : …" (queue T2)
7. Transition → log "✅ Transition → …" + host:trackUpdate émis
8. Ouvrir http://127.0.0.1:3069/join?code=<CODE> → vérifier titre affiché côté guest
9. Cliquer ⏭ Suivant → transition manuelle
10. Tester "⚡ Just Play" → soirée créée sans formulaire
```

## Sécurité

- **Client ID Spotify** : public (PKCE — pas de secret côté client)
- **Tokens Spotify** : `sessionStorage` uniquement
- **Socket auth** : `{ auth: { token: JWT_Supabase } }` → `socketAuth.js`
- **host:trackUpdate** : authentifié par membership de room `host:{code}` (pattern iOS)

> ⚠️ **Signalement** : iOS n'envoie pas `hostSecret` dans `host:trackUpdate` — le serveur
> fait confiance au socket s'il est dans la room `host:{code}`.
> En production, envisager de valider `hostSecret` dans le handler `host:trackUpdate`.

## Ce qui n'a PAS pu être testé sans navigateur/téléphone

- [ ] Enchaînement réel A→B à T-45s (requires live Spotify session)
- [ ] Detection transition sonde T-5s (requires track > 5s remaining)
- [ ] SSO Google OAuth flow (requires browser + réseau)
- [ ] device transfer iOS (requires Spotify Premium + device physique)
- [ ] Affichage guest sur join.ahouai.com réel (requires relay prod)
- [ ] Just Play flow end-to-end (requires Spotify session active)
- [ ] Upload photo couverture Cloudinary (non implémenté Phase 1)
- [ ] Compteur invités (requires guests qui rejoignent le code)
