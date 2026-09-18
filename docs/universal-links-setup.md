# Setup iOS Universal Links (AASA)

Ce guide explique comment configurer les Universal Links pour l'application iOS afin qu'elle intercepte automatiquement les liens de type `/join/[code]` (AhOuai party invites).

## 1. Fichier AASA et Déploiement

Le fichier Apple App Site Association (AASA) doit être placé sur le domaine qui servira les liens d'invitation (généralement `ahouai.com`).
Une version de base a été ajoutée dans `relay-server/public/.well-known/apple-app-site-association`.

**Important :**
- L'AASA doit être accessible via `https://ahouai.com/.well-known/apple-app-site-association`.
- **Content-Type** : Le serveur web doit servir ce fichier avec le header HTTP `Content-Type: application/json` (sans quoi iOS refusera de le parser).
- **Extension** : Ce fichier N'A PAS d'extension `.json` dans son nom.

### ⚠️ Ahouai-web vs Socialmix-relay
*(Question ouverte : Quel service hostera `ahouai.com` ?)*
Si `ahouai.com` est servi par le frontend `ahouai-web` (Next.js), **il faudra copier ce fichier vers `ahouai-web/public/.well-known/apple-app-site-association`**.
👉 *Action JS : Créer une PR sur `ahouai-web` pour y ajouter l'AASA si c'est Next.js qui porte le domaine principal.*

**Action Manuelle Requise (par Jean-Sébastien) :**
- Il faut remplacer les placeholders `<TEAM_ID>` et `<BUNDLE_ID>` par les valeurs réelles de l'application Guest dans ce fichier.
- Le Team ID est généralement visible dans le compte Apple Developer (ex: `DQDAY9MA9A`).
- Le Bundle ID est celui de l'application iOS (ex: `com.ahouai.app.guest`).

## 2. Configuration Xcode
Pour que l'application iOS intercepte les liens Universal Links :

1. Ouvrez le projet iOS dans Xcode.
2. Allez dans les réglages du projet, onglet **Signing & Capabilities**.
3. Ajoutez la capability **Associated Domains** si elle n'y est pas déjà.
4. Ajoutez l'entrée suivante :
   `applinks:ahouai.com`
   (Note: si vous avez des environnements de test, ajoutez aussi `applinks:votre-domaine-de-test.com`).

## 3. Interception dans SwiftUI
Dans l'application iOS, interceptez le lien via le handler `onOpenURL` sur votre vue principale :

```swift
import SwiftUI

@main
struct SocialMixApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    handleUniversalLink(url)
                }
        }
    }
    
    func handleUniversalLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
              let host = components.host, host == "ahouai.com" else {
            return
        }
        
        let pathComponents = url.pathComponents
        if pathComponents.count >= 3 && pathComponents[1] == "join" {
            let partyCode = pathComponents[2]
            // Router l'utilisateur vers l'écran de la soirée correspondante
            print("Ouverture de la soirée: \(partyCode)")
        }
    }
}
```

## 4. Tests
- Envoyez-vous le lien `https://ahouai.com/join/TEST123` par SMS, WhatsApp ou iMessage sur un iPhone physique.
- Touchez le lien : cela doit ouvrir l'application iOS directement sans passer par Safari.
