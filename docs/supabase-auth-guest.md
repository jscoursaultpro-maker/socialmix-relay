# Supabase Auth pour Guest Experience (Sprint B)

## Architecture & Flow
Pour assurer un SSO Google/Apple fluide depuis l'expérience Guest (hébergée sur `join.ahouai.com`), nous implémentons le flow Auth côté serveur (SSR) via Express.

### Le Flow OAuth :
1. Le client navigue vers l'URL Supabase d'authentification OAuth (avec un paramètre `redirect_to` pointant vers notre backend).
2. L'utilisateur s'authentifie sur Google/Apple.
3. Le provider redirige vers Supabase, qui à son tour redirige vers notre serveur : `https://join.ahouai.com/auth/callback?code=<oauth_code>`.
4. Le endpoint `/auth/callback` :
   - Échange le `code` OAuth contre une session complète en utilisant `supabaseAdmin.auth.exchangeCodeForSession(code)`.
   - Extrait le `access_token` et le `refresh_token`.
   - Définit des cookies `httpOnly` (`sb-access-token` et `sb-refresh-token`) pour sécuriser la session (inaccessible via JavaScript côté client).
   - Redirige l'utilisateur vers la page souhaitée (ou la racine).

## Utilisation du Middleware `verifySupabaseSession`

Pour protéger n'importe quel endpoint de l'API (ou pour des pages SSR à l'avenir), utilisez le middleware fourni.
Il parse le cookie `sb-access-token` et valide la session auprès de Supabase.

```javascript
import { verifySupabaseSession } from '../middleware/verifySupabaseSession.js';

app.get('/api/protected-route', verifySupabaseSession, (req, res) => {
  // L'utilisateur est authentifié.
  // Les infos sont disponibles dans req.supabaseUser :
  console.log(req.supabaseUser.id);
  console.log(req.supabaseUser.email);
  
  res.json({ message: "Accès autorisé", user: req.supabaseUser });
});
```

## Variables d'Environnement Requises (Render)

Pour que ce système fonctionne, les variables d'environnement suivantes DOIVENT être configurées dans le dashboard de Render (pour le service `socialmix-relay`) :

- `SUPABASE_URL` : L'URL du projet Supabase (ex: `https://xjcomwhzupwiqbahaisc.supabase.co`)
- `SUPABASE_ANON_KEY` : La clé publique (anon key) pour les requêtes publiques et la validation simple des tokens.
- `SUPABASE_SERVICE_ROLE_KEY` : La clé secrète admin. **ATTENTION : Ceci est un secret.** Nécessaire pour pouvoir échanger le code OAuth côté serveur de manière sécurisée. (Trouvable dans Supabase Dashboard → Settings → API → `service_role` secret).

## URLs de Redirection Supabase

Assurez-vous que l'URL suivante est autorisée dans les paramètres d'authentification de Supabase (Redirect URLs) :
- `https://join.ahouai.com/auth/callback`
- `https://join.ahouai.com/**`
