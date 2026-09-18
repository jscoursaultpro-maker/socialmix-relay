# Setup iOS Universal Links (AASA)

Ce guide explique comment configurer les Universal Links pour l'application SocialMixGuest iOS afin qu'elle intercepte automatiquement les liens `/join/[code]` (AhOuai party invites).

## 1. Fichier AASA
Le fichier Apple App Site Association (AASA) a été déployé côté web (dans `ahouai-web/public/.well-known/apple-app-site-association`).

**Action Manuelle Requise (par Jean-Sébastien) :**
- Il faut remplacer les placeholders `<TEAM_ID>` et `<BUNDLE_ID>` par les valeurs réelles de l'application Guest dans ce fichier sur le repo web.
- Le Team ID est généralement visible dans le compte Apple Developer (ex: `DQDAY9MA9A`).
- Le Bundle ID est celui de l'application Guest iOS (ex: `com.ahouai.app.guest`).

## 2. Configuration Xcode
Pour que l'application iOS intercepte les liens Universal Links :

1. Ouvrez le projet iOS de SocialMixGuest dans Xcode.
2. Allez dans les réglages du projet, onglet **Signing & Capabilities**.
3. Ajoutez la capability **Associated Domains** si elle n'y est pas déjà.
4. Ajoutez l'entrée suivante :
   `applinks:ahouai.com`
   (Note: si vous avez des environnements de test, ajoutez aussi `applinks:votre-domaine-de-test.com`).

## 3. Interception dans SwiftUI
Dans l'application iOS, interceptez le lien via le handler `onOpenURL` sur votre vue principale (ContentView ou MainTabView) :

```swift
import SwiftUI

@main
struct SocialMixGuestApp: App {
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
- Envoyez-vous le lien `https://ahouai.com/join/TEST123` par SMS, WhatsApp ou iMessage sur un iPhone physique (ou simulateur avec l'app installée).
- Touchez le lien : cela doit ouvrir l'application SocialMixGuest directement sans passer par Safari.
- Si le lien s'ouvre dans Safari, déroulez la page vers le haut : une bannière "Ouvrir dans l'app" devrait s'afficher si la configuration est correcte mais que le système a mémorisé Safari comme préférence.
