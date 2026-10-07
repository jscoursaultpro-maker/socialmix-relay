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
