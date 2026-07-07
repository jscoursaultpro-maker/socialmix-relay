# SPEC : Refonte UX Guest Web App

## 1. Contexte et objectifs

La Guest Web App actuelle (HTML/JS statique connectée via Socket.IO) est pleinement fonctionnelle mais possède une interface basique. L'objectif de cette refonte est d'aligner l'UX/UI de la Web App Guest sur l'expérience premium et dynamique de l'application iOS Hôte.

**Fonctionnalités actuelles (V1) identifiées :**
- Connexion avec code Party ou scan QR
- Onboarding invité (Profil, Pseudo, Emoji, Upload photo)
- Trombinoscope pre-party
- Cockpit Live : affichage du morceau en cours (Now Playing) et du morceau à venir
- Interactions temps réel : Vote (👍, 👎, 🔥) et suggestions de titres
- Messagerie/Chat
- Trombinoscope et Leaderboard de la soirée
- Graphiques des tendances (Genre Trends)
- Écran récapitulatif (Party Ended / Leave)

## 2. Cible visuelle (AhOuai Style)

Pour correspondre au look iOS premium :
- **Background :** Dark background gradient avec une base noire pure et de subtiles lumières (#accentTurquoise).
- **Couleur Primaire :** Turquoise (#00E5FF) pour les CTA, halos et indicateurs de progression.
- **Glassmorphism :** Les cartes et overlays utilisent `rgba(255, 255, 255, 0.05)` avec un flou d'arrière-plan (`backdrop-filter: blur(10px)`) et une très légère bordure blanche `rgba(255,255,255,0.1)`.
- **Typographie :** SF Pro (iOS system font) en fallback `system-ui, -apple-system, BlinkMacSystemFont`. Poids dynamiques (Heavy pour les titres, Medium/Regular pour le corps).
- **Animations :** Transitions douces (`transition: all 0.3s ease-out`), Staggered entrances pour les listes, feedback haptique visuel (scale-down) sur le clic des boutons de vote.

## 3. Écrans/Vues à concevoir

### Écran 1 : Landing
```text
+-------------------------+
|                         |
|      [Logo AhOuai]      |
|                         |
|   Entre ton code pour   |
|   rejoindre la soirée   |
|                         |
|   [ _______ ] (Input)   |
|                         |
|   (Bouton: Rejoindre)   |
|                         |
|   --- ou scanner QR --- |
|                         |
+-------------------------+
```
- **Interactions :** Validation automatique si le code fait 6 caractères. Feedback erreur shake.

### Écran 2 : Onboarding
```text
+-------------------------+
|      Qui es-tu ?        |
|                         |
|      [ Avatar ]         |
|   (Appuie pour photo)   |
|                         |
|   [ Ton prénom    ]     |
|   [ Choisis Emoji ]     |
|                         |
|  (Bouton: C'est parti)  |
+-------------------------+
```

### Écran 3 : Live Cockpit Guest
```text
+-------------------------+
| [Avatar]      [Phase]   |
|-------------------------|
|     (Cover Art)         |
|                         |
| Titre du morceau        |
| Artiste                 |
|                         |
|  [👍]   [🔥]   [👎]     |
|-------------------------|
| [Proposer un son] (Btn) |
|-------------------------|
| Messages (chat mini)    |
+-------------------------+
```
- **Composants :** Cover art flottante avec légère ombre turquoise si 🔥 dominant.

### Écran 4 : Historique / Classement (Hub)
```text
+-------------------------+
| < Retour       Hub      |
|-------------------------|
| [ Onglets : Historique /|
|   Missions / Classement]|
|-------------------------|
| 1. Titre A (👍 12)      |
| 2. Titre B (🔥 8)       |
| 3. Titre C (👎 3)       |
+-------------------------+
```

### Écran 5 : Party Ended
```text
+-------------------------+
|      [Confettis]        |
|                         |
|     Soirée terminée     |
|                         |
|   Ton palmarès :        |
|   - 5 suggestions       |
|   - 12 votes            |
|                         |
|  (Bouton: Revenir à     |
|   l'accueil)            |
+-------------------------+
```

## 4. Composants réutilisables
- **`.glass-card`** : Conteneur principal pour isoler le contenu.
- **`.btn-primary`** : Bouton pill-shape fond turquoise, texte noir, gras.
- **`.btn-vote`** : Bouton circulaire avec effet pop au clic.
- **`.toast`** : Notification flottante en bas de l'écran, glassmorphism sombre.
- **`.avatar`** : Image circulaire avec border interne `rgba(255,255,255,0.2)`.

## 5. Animations & transitions
- **Load (Fade & Slide) :** Les éléments montent de 10px en `opacity: 0 -> 1`.
- **Voting :** Le bouton vote réduit (`scale: 0.9`) puis reprend sa taille. Des particules ou un léger glow turquoise apparaissent sur un super vote (🔥).
- **Track Change :** Crossfade fluide de la cover art avec mise à jour du blur background en dessous.

## 6. Gestion des états critiques
- **Offline :** Bandeau sticky rouge en haut `Connexion perdue. Reconnexion en cours...`.
- **Éviction / Party Ended :** Affichage forcé d'une modale non-dismissible recouvrant tout l'écran.
- **Erreurs d'input :** Shake animation horizontale sur l'input code en cas de `PARTY_NOT_FOUND`.

## 7. Comparaison Guest V1 vs V2

| Fonctionnalité | Guest V1 (Actuel) | Guest V2 (Refondu) |
|---|---|---|
| **Design** | CSS standard, flat | Glassmorphism, animations, dark mode |
| **Structure** | Monopage lourde | Sections (SPA) fluides via transition CSS |
| **Boutons Vote**| Standards | Haptiques visuels avec glow effect |
| **Leaderboard** | Tableau simple | Cartes classées avec médailles dynamiques |
| **Feedback** | Alert / console | Toasts animés en bas de l'écran |

## 8. Estimation effort dev
- **Refonte CSS (Création des tokens, classes utilitaires) :** ~1j
- **Refactor JS (Gestions des modales / transitions SPA) :** ~1j
- **Nouveaux écrans (Intégration du Layout HTML) :** ~1j
- **Tests & Polish (Responsive, Mobile Safari) :** ~0.5j
- **Total estimé :** ~3,5 à 4 jours pleins (pour un AI ou Dev Senior).
