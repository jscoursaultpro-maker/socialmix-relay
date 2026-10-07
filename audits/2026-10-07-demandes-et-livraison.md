# AhOuai — audit des demandes du 7 octobre 2026

Ce document distingue code intégré, livraison et validation fonctionnelle. Un build réussi ne valide pas à lui seul un parcours réel entre Host et Guest.

## Correction immédiate
- [x] Backstage exclusivement Host : masquer bouton et écran dès le HTML/CSS, contrôler l'ouverture par showTab, éviter qu'un moteur Host d'une autre soirée active le mode Host.
- [ ] Vérifier cette correction en production : push GitHub rejeté par erreur serveur HTTP 500.

## Entrée et identité
- [x] Refonte connexion / découverte / choix créer-rejoindre-sortir intégrée.
- [x] Onboarding conservé pour les non connectés, CTA découvrir dès le début.
- [x] Vrai logo AhOuai et identité turquoise-violet-rose intégrés.
- [x] Icône intégrée ; vérifier l'icône réellement installée sur iPhone.
- [x] Attente restauration Keychain et conservation session/profil/jetons sur erreur temporaire intégrées.
- [ ] Validation iPhone : relance, réseau indisponible, reconnexion et absence de l'ancien écran.

## Host et préparation
- [x] Storytelling Web Host et création responsive intégrés et livrés avant les derniers commits.
- [x] Soirées planifiées : date, texte, photo, liens, invitations amis, accueil, participants et démarrage explicite intégrés.
- [ ] Vérifier QR/lien avant lancement : inscription possible sans démarrer la musique, absence d'ambiguïté planifier/lancer.
- [ ] Valider écrans iOS profil, musique, création et invitation contre les références graphiques ; ne pas les considérer tous validés parce que la connexion l'est.
- [ ] Vérifier admission « Faire entrer », nom et photo d'un invité déjà connu avec deux comptes réels.

## Contributions et My Touch
- [x] Renommage My Vibe / On Air / My Touch / Best Of / Backstage intégré.
- [x] Correctifs pochettes, propositions immédiates, exclusion de l'auto-boost, classement intégrés.
- [ ] Reproduire les anomalies Never Going Home / Palomar, latence des propositions, classement après premier vote.
- [x] Mes amis et aperçu univers limités aux présents intégrés ; accès à tous les univers conservé.
- [x] My Touch commun propriétaire/visiteur : favoris feu de la soirée, suggestions avec statut, mots et photos intégrés et compilés.
- [x] Visiteur : booster une proposition, aimer/désaimer photo ou mot, message privé intégrés ; likes idempotents testés.
- [ ] Dernière version My Touch publiée : commits locaux, push GitHub rejeté par erreur serveur.
- [ ] Vérifier les accès depuis tous les portraits/participants iOS et Web, pas uniquement la fiche de contact.
- [ ] Clarifier les favoris historiques : actuellement seuls les feux de cette soirée sont exposés.
- [ ] Vérifier échanges/likes/boosts en direct entre Nicolas et Daphné avec deux comptes réels.

## Modération distincte du social
- [x] Module Backstage indépendant de My Touch.
- [x] Signalement guest par entrée séparée « Prévenir l'organisateur ».
- [x] Premier incident avertissement privé automatique ; second incident alerte Host.
- [x] Ban 15 minutes / définitif pour cette soirée / invité marqué parti / autoriser le retour intégrés.
- [x] Contrôles serveur des droits, protection des messages privés et expiration testés localement.
- [ ] Tester notification réelle, reprise après 15 min et effet sur tous les clients.

## Livraison et validation
- [x] Modifications de la branche iOS existante conservées ; fichiers personnels non suivis non inclus.
- [x] Builds iOS réussis ; tests serveur locaux réussis ; scans secrets pré-commit réussis.
- [ ] Livraison derniers commits Web et iOS : blocage GitHub externe, pas une validation terminée.
- [ ] Validation visuelle et fonctionnelle iPhone + Web Host + Web Guest.
- [ ] Décider du retrait du sélecteur A/B et du badge Beta après validation ; encore présents.

Aucun parcours Host ou Guest n'est déclaré entièrement achevé avant les validations ouvertes ci-dessus.

## Réconciliation du handoff fourni par Jean-Sé

Le handoff décrit un état antérieur. L'intégration entrée/auth dans le dépôt Xcode est déjà faite (9275532 et évolutions suivantes). Ne pas réappliquer ios-entry-auth.patch aveuglément. Les builds complets du scheme AhOuai ont réussi depuis le problème de dépendances du checkout isolé.

Le catalogue d'assets réel contient AhOuaiWordmark.imageset et AppIcon.appiconset/icon_1024.png. Le nom icon_1024-brand.png du handoff ne doit pas être imposé : vérifier le contenu et Contents.json plutôt que le seul nom.

- [ ] Comparer au vrai Relay les changements du checkout /Users/Jean-Sebastien/Documents/Codex/ahouai-final-round/relay-server : 65a5dd9 (rôle guest et diaporama), c6cc4e0 (QR), e792468 (Bangers/propositions/scores Host). Ces SHA ne figurent pas dans l'historique récent du vrai Relay ; certains comportements peuvent déjà avoir été repris autrement. Intégrer uniquement les différences utiles sans écraser les nouveaux parcours.
- [ ] Comparer les premiers commits iOS du handoff avec le vrai dépôt : persistance suggestions, scores Int, déduplication, file 6 titres et Voir plus, placement Enchaînement automatique / À suivre, QR et diaporama. Confirmer comportement par comportement, pas uniquement par SHA.
- [ ] Tester un Host et au moins deux Guests : suggestion Envoyée après changement d'onglet et reconnexion, Mes suggestions avant crew, boosts persistants, scores directs, classement après reconnexion, aucun doublon.
- [ ] Tester le titre promu par Host comme prochain morceau ; file de 6 titres puis Voir plus ; Terminer depuis facette B ferme réellement la soirée et renvoie les invités à l'accueil.
- [ ] Tester copie et partage du lien/QR sur toutes les facettes et présence du CTA quitter diaporama en portrait/paysage.
- [ ] Tester démarrage Web Host YouTube et Spotify sur le vrai dépôt actuel, propositions/Bangers et scores en bout en bout.
- [ ] Tester visibilité privée/amis/publique, sortie de salle d'attente, absence de requestJoin fantôme et état connecté/déconnecté.
- [ ] Tester persistance des suggestions après redémarrage serveur.
- [ ] Vérifier pochettes Bangers ET First Taste sur toutes les facettes.
- [ ] QA visuelle iPhone connexion, accueil, choix, création, My Vibe, On Air, My Touch, Best Of, Backstage Host, QR, diaporama : contraste, texte, safe areas, petits écrans, troncatures ; 4 onglets Guest, 5 Host.
- [ ] Après livraison : vérifier version réellement servie et logs Render ; ne pas confondre push réussi avec déploiement terminé.

### Nouveau point à cadrer : GET /api/sitemap
- [ ] Définir Hosts publics/indexables, soirées exposables, correspondance base62/code, limites/pagination et protection des soirées privées.
- [ ] Développer et tester l'endpoint une fois ces règles établies. Il n'est pas livré et ne fait pas partie des corrections déjà réalisées.

La consigne de non-déploiement contenue dans l'ancien handoff décrit son état de validation d'alors. Les autorisations explicites ultérieures de Jean-Sé de pousser ce qui est prêt restent le contexte de livraison ; cette lecture du handoff n'a déclenché aucun push ni déploiement.

## Exécution autonome — avancement complémentaire

- [x] My Touch personnel : sections favoris feu, titres joués, titres en attente, messages publiés, photos publiées et classement ajoutées au Web et au cockpit iOS partagé Host/Guest.
- [x] Titres joués retirés de la file retrouvés depuis l'historique ; contenu supprimé exclu ; propre proposition jamais boostable dans le rendu personnel.
- [x] Réconciliation des trois commits Relay : changements manquants de scores/identité Host, QR et diaporama récupérés sans remplacer les nouveaux parcours.
- [x] Réconciliation iOS : file progressive de 6 titres, placement enchaînement, diaporama brandé, QR brandé et copie du QR récupérés ; participants dédupliqués par userId ou session, jamais par seul prénom.
- [x] Suite native Node rendue exécutable sans Vitest ; correction du trim avant suppression du suffixe de nom.
- [x] 35 tests unitaires passent ; deux tests de démarrage Web Host passent.
- [x] 53 tests d'intégration isolés MongoMemoryServer passent : auth, RGPD, suppression compte, lifecycle, collision, isolation Host, provider IDs, boosts et write-through.
- [x] Fixtures de test actualisées : codes valides, authentification des suppressions, secret JWT éphémère indépendant, nettoyage du serveur de test.
- [x] GitHub accepte de nouveau les pushes : les anciens commits Relay bloqués ont été envoyés.
- [ ] Confirmer le déploiement des changements complémentaires après leur commit/push et le dernier build iOS.

Restent non validés : expérience réelle avec plusieurs appareils, sessions Apple/Google et réseau physique, lecture Spotify/Apple/YouTube réelle, comparaison visuelle exhaustive des écrans et photos, maintien après redémarrage complet du service. Les tests locaux ne remplacent pas ces validations. La visite du My Touch d'autrui, les favoris historiques et sitemap restent volontairement différés.

## Livraison confirmée après exécution

- [x] Web da04338 poussé ; fichiers community et host-mode servis en production identiques aux fichiers locaux.
- [x] iOS 53ca2e3 poussé sur feat/cockpit-b-moderation-photos-messages ; build scheme AhOuai réussi, sans remplacer les évolutions de la branche.
- [x] Correctif de scores du handoff aa7ae6e récupéré après comparaison : conversion Int/NSNumber/String, hydratation du leaderboard depuis party:state, déduplication stable des invités.
- [x] Navigation et montage Backstage protégés côté Guest, y compris avant initialisation JS.
- [x] Ancien libellé mon cercle retiré des dernières surfaces Afterglow iOS ; badge technique v2 retiré de la personnalisation.

Les cases de validation réelle ouvertes plus haut restent ouvertes même si les correctifs correspondants existent. Les décisions encore différées restent : visite de My Touch d'autrui, favoris inter-soirées, indexation sitemap, retrait du sélecteur A/B et Beta avant validation visuelle. Les sessions et services musicaux réels nécessitent des comptes autorisés connectés ; aucune fausse validation n'est déclarée.
