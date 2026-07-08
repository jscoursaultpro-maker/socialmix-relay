# Politique de Confidentialité — AhOuai

**Version 1.0**
**Date d'entrée en vigueur : [À COMPLÉTER avant publication]**

---

## Préambule

Chez AhOuai, la protection de vos données personnelles est une priorité. La présente Politique de Confidentialité (ci-après « la Politique ») décrit de manière transparente quelles données sont collectées lors de votre utilisation de l'application AhOuai (ci-après « l'Application »), à quelles fins, pendant combien de temps, avec qui elles sont partagées, et quels sont vos droits.

Elle est rédigée en conformité avec :

- Le Règlement (UE) 2016/679 du 27 avril 2016 relatif à la protection des personnes physiques à l'égard du traitement des données à caractère personnel (ci-après « RGPD »)
- La loi n° 78-17 du 6 janvier 1978 modifiée relative à l'informatique, aux fichiers et aux libertés (ci-après « Loi Informatique et Libertés »)
- Les lignes directrices de la Commission Nationale de l'Informatique et des Libertés (CNIL)

En utilisant l'Application, vous reconnaissez avoir pris connaissance de la présente Politique.

---

## 1. Responsable du traitement

Le responsable du traitement des données personnelles collectées via l'Application est :

- **Nom** : Jean-Sébastien Coursault
- **Statut** : Personne physique
- **Adresse postale** : [À COMPLÉTER avant publication]
- **Email de contact** : `contact@ahouai.com`

En Version 1.0, aucun Délégué à la Protection des Données (DPO) n'est désigné, l'Éditeur ne réunissant pas les seuils rendant obligatoire cette désignation (art. 37 RGPD). Pour toute demande relative à la protection de vos données, contactez directement `contact@ahouai.com`.

---

## 2. Données personnelles collectées

### 2.1. Données collectées auprès de l'Hôte

Lorsque vous utilisez AhOuai en tant qu'hôte de soirée, les données suivantes sont collectées :

- **Identité déclarative** : prénom, emoji choisi, photo de profil (facultative)
- **Données d'authentification (à partir de la Version 1.0)** : adresse email, identifiant Apple (via Sign in with Apple), identifiant Google, mot de passe haché
- **Données de soirée** : nom de la soirée, code de la soirée, historique des tracks jouées, choix musicaux, décisions dramaturgiques (mode de dramaturgie, verrouillage de phase)
- **Choix de service musical** : Apple Music, Spotify, Deezer, ou aucun

### 2.2. Données collectées auprès de l'Invité

Lorsque vous rejoignez une soirée en tant qu'invité :

- **Identité déclarative** : prénom, emoji choisi
- **Contribution à la soirée** : votes émis (Bof, Cool, Feu), suggestions musicales, messages/post-its envoyés, photos prises et partagées
- **Score et badges** : points accumulés dans le cadre de la gamification

⚠️ **En Version 1.0, l'invité ne crée pas de compte permanent**. Ses données sont attachées à une session temporaire, liée à la soirée à laquelle il participe.

### 2.3. Données techniques collectées automatiquement

Que vous soyez hôte ou invité, les données suivantes sont collectées automatiquement pour le fonctionnement du Service :

- **Adresse IP** (pour établir la connexion Socket.IO en temps réel)
- **User-Agent** (type d'appareil et de navigateur, pour compatibilité)
- **Identifiants techniques** (identifiant de session, jeton de session, identifiant de socket)
- **Journaux d'événements techniques** (connexions, déconnexions, actions dans l'Application)
- **Rapports d'erreur et de crash** (envoyés au service Sentry pour diagnostic)
- **Métriques de performance** (temps de réponse, utilisation mémoire, latence)

### 2.4. Données de paiement (Version 1.1 et ultérieures)

En Version 1.0, aucune donnée de paiement n'est collectée, l'Application étant entièrement gratuite. Dans les versions ultérieures, en cas d'introduction d'un plan Pro payant :

- **Via RevenueCat (iOS)** : identifiant d'abonnement Apple, dates de début et de fin d'abonnement, plan souscrit. Les données bancaires elles-mêmes ne transitent jamais par AhOuai et sont gérées exclusivement par Apple.
- **Via Stripe (web, le cas échéant)** : identifiant de transaction, montant, plan souscrit. Les données bancaires sont gérées exclusivement par Stripe.

### 2.5. Données que nous ne collectons pas

Pour votre information, AhOuai ne collecte **jamais** :

- Vos coordonnées GPS ou de géolocalisation (l'Application n'a pas accès à votre position)
- Votre carnet de contacts, calendrier ou photos personnelles hors des photos volontairement prises pendant une soirée
- Vos données bancaires (gérées par Apple/Stripe uniquement, jamais par AhOuai)
- Vos données de navigation web hors de l'Application
- Vos échanges sur d'autres applications de messagerie

---

## 3. Finalités et bases légales du traitement

| Finalité | Base légale (art. 6 RGPD) |
|----------|---------------------------|
| Fournir le Service AhOuai (création de soirée, temps réel, votes, photos, etc.) | Exécution du contrat (art. 6.1.b) |
| Authentification et sécurité du compte (V1.0+) | Exécution du contrat (art. 6.1.b) |
| Gestion des abonnements payants (V1.1+) | Exécution du contrat (art. 6.1.b) |
| Amélioration continue de l'Application (analytics agrégées, non nominatives) | Intérêt légitime (art. 6.1.f) |
| Prévention de la fraude, de l'abus et sécurisation du Service | Intérêt légitime (art. 6.1.f) |
| Diagnostic technique via rapports de crash (Sentry) | Intérêt légitime (art. 6.1.f) |
| Respect des obligations légales et comptables | Obligation légale (art. 6.1.c) |
| Envoi de communications marketing (newsletter, promotions) — V1.1+ | Consentement explicite (art. 6.1.a) |
| Réponse aux demandes de support ou de droits RGPD | Exécution du contrat / Obligation légale |

Vous pouvez à tout moment retirer votre consentement pour les traitements qui en dépendent (marketing), sans que cela n'affecte la licéité du traitement effectué avant le retrait.

---

## 4. Destinataires et sous-traitants

### 4.1. Accès interne

Les données sont accessibles uniquement à l'Éditeur (Jean-Sébastien Coursault) et éventuellement à des collaborateurs techniques dûment habilités, dans le cadre strict de la fourniture et de la maintenance du Service.

### 4.2. Sous-traitants techniques

AhOuai s'appuie sur les sous-traitants suivants, tous soumis à des obligations contractuelles de confidentialité et de sécurité conformes au RGPD :

| Prestataire | Rôle | Pays d'hébergement | Encadrement des transferts |
|-------------|------|---------------------|----------------------------|
| **Render Services, Inc.** | Hébergement du serveur relais (relay-server) | Frankfurt, Allemagne (UE) | Traitement UE, pas de transfert hors UE |
| **MongoDB, Inc.** (MongoDB Atlas) | Base de données | UE (Frankfurt) ou US (Virginia) selon configuration | Clauses Contractuelles Types (CCT) UE |
| **Cloudinary Ltd.** | Stockage et transformation des photos | US / UE | Data Privacy Framework + CCT |
| **Functional Software, Inc.** (Sentry) | Monitoring des erreurs et crashes | États-Unis | Data Privacy Framework + CCT |
| **Apple Distribution International Ltd.** | Distribution App Store, MusicKit, Sign in with Apple, RevenueCat (via App Store) | Irlande (UE) / États-Unis | Traitement principalement UE + DPF |
| **Google LLC** | Sign in with Google (V1.0+) | États-Unis | Data Privacy Framework + CCT |
| **Spotify AB** | API Spotify (déclenchement lecture) | Suède (UE) | Traitement UE |
| **Deezer S.A.** | API Deezer (déclenchement lecture) | France (UE) | Traitement UE |
| **ACRCloud** | Reconnaissance musicale (mode DJ Live) | Chine, Singapour, US | CCT + audit sécurité |
| **RevenueCat, Inc.** (V1.1+) | Gestion des abonnements iOS | États-Unis | Data Privacy Framework + CCT |
| **Stripe, Inc.** (V1.1+, web) | Traitement des paiements par carte | Irlande (UE) / États-Unis | Traitement UE + DPF |
| **Anthropic PBC** | Assistance à la rédaction de contenus (Claude, en mode Cowork) | États-Unis | Traitement des données par le seul Éditeur, pas des données Utilisateur |

Aucun de ces sous-traitants n'est autorisé à utiliser vos données à d'autres fins que celles strictement nécessaires à la fourniture du Service.

### 4.3. Autorités publiques

Les données personnelles peuvent être communiquées à des autorités administratives ou judiciaires françaises sur réquisition légale.

### 4.4. Absence de vente ou de partage à des fins publicitaires

L'Éditeur **ne vend**, **ne loue** et **ne cède** vos données personnelles à aucun tiers à des fins commerciales, publicitaires ou de profilage marketing.

---

## 5. Transferts de données hors de l'Union européenne

Certains sous-traitants (Cloudinary, Sentry, MongoDB en configuration US, Apple, Google, Anthropic, ACRCloud) traitent des données hors de l'Union européenne, principalement aux États-Unis.

Ces transferts sont encadrés par les mécanismes suivants prévus par le RGPD :

- **Data Privacy Framework** (adéquation UE-US, décision d'adéquation du 10 juillet 2023 pour les entreprises certifiées)
- **Clauses Contractuelles Types (CCT)** de la Commission européenne (art. 46 RGPD)
- Le cas échéant, garanties additionnelles techniques et organisationnelles (chiffrement en transit et au repos, contrôles d'accès stricts)

L'Utilisateur peut demander une copie de ces garanties en écrivant à `contact@ahouai.com`.

---

## 6. Durées de conservation

| Catégorie de données | Durée de conservation |
|-----------------------|------------------------|
| Compte hôte (V1.0+) : identifiants d'authentification, prénom, emoji | Tant que le compte est actif, puis 12 mois après la dernière connexion (sauf demande de suppression) |
| Contenus de soirée : historique des tracks, votes, scores, participants, messages | 12 mois après la fin de la soirée, puis suppression ou anonymisation |
| Photos de soirée | 12 mois après la fin de la soirée, puis suppression |
| Journal de session invité (session-scope) | Fin immédiate de session à la clôture de la soirée, données anonymisées après 12 mois |
| Adresse IP (logs serveur) | 12 mois maximum, puis suppression |
| Rapports de crash Sentry | 90 jours (rétention par défaut Sentry) |
| Données de paiement et facturation (V1.1+) | 10 ans (obligation comptable, art. L. 123-22 du Code de commerce) |
| Demandes d'exercice de droits RGPD | 3 ans après la clôture de la demande (preuve du traitement) |
| Signalements de contenus illicites | 5 ans après signalement (obligations LCEN) |

À l'expiration de ces durées, les données sont soit supprimées définitivement, soit anonymisées de manière irréversible pour des besoins de statistiques agrégées.

---

## 7. Vos droits (RGPD)

Conformément aux articles 15 à 22 du RGPD et à la loi Informatique et Libertés, vous disposez des droits suivants sur vos données personnelles :

### 7.1. Droit d'accès (art. 15 RGPD)

Vous avez le droit d'obtenir la confirmation que vos données sont traitées et, le cas échéant, une copie de ces données ainsi que des informations complémentaires (finalités, catégories, destinataires, durées, origine).

### 7.2. Droit de rectification (art. 16)

Vous pouvez demander la correction ou la complétion de vos données personnelles si elles sont inexactes, incomplètes ou obsolètes.

### 7.3. Droit à l'effacement (« droit à l'oubli », art. 17)

Vous pouvez demander la suppression de vos données personnelles dans les cas prévus par le RGPD (données devenues inutiles, retrait du consentement, opposition légitime, traitement illicite, obligation légale d'effacement).

### 7.4. Droit à la limitation du traitement (art. 18)

Vous pouvez demander la limitation du traitement de vos données (blocage temporaire) dans certains cas, notamment en cas de contestation de l'exactitude des données ou d'opposition au traitement.

### 7.5. Droit à la portabilité des données (art. 20)

Vous avez le droit de recevoir vos données personnelles dans un format structuré, couramment utilisé et lisible par machine (JSON), et de les transmettre à un autre responsable de traitement.

### 7.6. Droit d'opposition (art. 21)

Vous pouvez vous opposer, à tout moment, au traitement de vos données personnelles fondé sur l'intérêt légitime de l'Éditeur, pour des raisons tenant à votre situation particulière. Vous pouvez également vous opposer sans motif au traitement à des fins de prospection commerciale.

### 7.7. Droit de retirer votre consentement

Lorsque le traitement est fondé sur le consentement (par exemple, communications marketing), vous pouvez le retirer à tout moment, sans que cela n'affecte la licéité du traitement effectué avant le retrait.

### 7.8. Droit de ne pas faire l'objet d'une décision automatisée (art. 22)

Voir la section 11 sur les décisions automatisées.

### 7.9. Droit de définir des directives post-mortem

Conformément à l'article 85 de la loi Informatique et Libertés, vous pouvez définir des directives relatives au sort de vos données après votre décès.

### 7.10. Modalités d'exercice de vos droits

Pour exercer l'un de ces droits, envoyez un email à `contact@ahouai.com` en précisant :

- Le droit que vous souhaitez exercer
- Votre identifiant AhOuai (email de connexion ou pseudo utilisé)
- Un justificatif d'identité (copie de pièce d'identité) si l'Éditeur a un doute raisonnable sur votre identité

L'Éditeur s'engage à répondre à votre demande dans un délai maximum d'**un mois** à compter de sa réception. Ce délai peut être prolongé de deux mois en cas de complexité ou de multiplicité des demandes, avec information motivée dans un délai d'un mois.

L'exercice de vos droits est **gratuit**, sauf en cas de demande manifestement infondée ou excessive (auquel cas des frais raisonnables pourront être demandés ou la demande refusée).

---

## 8. Traitement des données des mineurs

### 8.1. Âge minimum

L'utilisation d'AhOuai est réservée aux personnes âgées de **13 ans minimum**, conformément aux règles de l'App Store d'Apple.

### 8.2. Accord parental obligatoire (utilisateurs français de 13 à 15 ans)

Pour les utilisateurs mineurs de **13 à 15 ans résidant en France**, le traitement des données personnelles nécessite l'accord conjoint du mineur et du titulaire de l'autorité parentale, conformément à :

- L'article 8 du RGPD
- L'article 45 de la loi n° 78-17 du 6 janvier 1978

En Version 1.0, la vérification de cet accord repose sur une **déclaration de l'Utilisateur lors de la première utilisation**. Un mécanisme de confirmation renforcée par email parental sera introduit dans une version ultérieure.

### 8.3. Utilisateurs européens de 13 à 16 ans

Selon les législations nationales des États membres de l'UE, l'âge de consentement autonome varie entre 13 et 16 ans. Les utilisateurs concernés sont invités à vérifier la législation applicable dans leur pays et, en cas de doute, à obtenir l'accord parental.

### 8.4. Signalement d'utilisation par un mineur

Si vous êtes titulaire de l'autorité parentale sur un enfant de moins de 15 ans utilisant AhOuai sans votre accord, contactez immédiatement `contact@ahouai.com`. L'Éditeur procédera à la suspension du compte et à l'effacement des données dans un délai maximum de 7 jours.

---

## 9. Sécurité des données

### 9.1. Mesures techniques

L'Éditeur met en œuvre les mesures techniques suivantes pour protéger vos données :

- **Chiffrement en transit** : toutes les communications entre l'Application, le serveur relais et les sous-traitants utilisent les protocoles HTTPS et WSS (WebSocket sécurisé)
- **Chiffrement au repos** : les données stockées dans MongoDB Atlas et Cloudinary sont chiffrées au niveau du disque
- **Hachage des mots de passe** (V1.0+) : les mots de passe sont stockés uniquement sous forme hachée avec l'algorithme bcrypt, jamais en clair
- **Isolation des données** : les données de chaque soirée sont isolées par un code unique, sans possibilité d'accès croisé
- **Contrôles d'accès** : accès aux données brutes limité à l'Éditeur, avec authentification par jetons sécurisés
- **Sauvegardes régulières** : sauvegardes automatiques des bases de données pour prévenir la perte de données
- **Monitoring temps réel** : détection des anomalies via Sentry et journaux applicatifs
- **Rate limiting** (V1) : limitation des requêtes pour prévenir les attaques par force brute et le spam

### 9.2. Mesures organisationnelles

- Formation continue de l'Éditeur aux enjeux de sécurité et de protection des données
- Politique de gestion des mots de passe forts pour les accès administrateurs
- Rotation régulière des clés d'API et des secrets d'authentification
- Journalisation des accès aux données personnelles
- Contrats de sous-traitance conformes au RGPD

### 9.3. Notification d'une violation de données

En cas de violation de données personnelles présentant un risque pour vos droits et libertés, l'Éditeur s'engage à :

- Notifier la CNIL dans un délai de 72 heures après en avoir pris connaissance (art. 33 RGPD)
- Vous informer sans délai dans les cas où la violation présente un risque élevé pour vos droits (art. 34 RGPD)

---

## 10. Cookies et traceurs

### 10.1. Application iOS

L'Application iOS AhOuai n'utilise **aucun cookie**, s'agissant d'une application native.

### 10.2. Interface web invité (join.ahouai.com)

L'interface web utilisée par les invités pour rejoindre une soirée utilise uniquement :

- **Cookies techniques strictement nécessaires** au fonctionnement du Service (jeton de session, préférences temporaires de soirée)
- **Stockage local (localStorage)** pour maintenir la session entre les rafraîchissements de page

Conformément à l'article 82 de la loi Informatique et Libertés, ces cookies techniques ne nécessitent pas de consentement préalable.

**AhOuai n'utilise aucun cookie de traçage, de mesure d'audience, de publicité ou de partage vers des réseaux sociaux.** Aucun cookie tiers de type Google Analytics, Facebook Pixel, Meta, LinkedIn Insight Tag ou équivalent n'est déposé.

### 10.3. Interface admin (admin.ahouai.com)

L'interface d'administration d'AhOuai n'est utilisée que par l'Éditeur et n'utilise que des cookies techniques d'authentification. Elle n'est pas accessible aux Utilisateurs.

---

## 11. Décisions automatisées et profilage

### 11.1. Algorithme « DJ Brain »

AhOuai intègre un algorithme de recommandation musicale nommé **« DJ Brain »**, qui suggère automatiquement les prochains morceaux en fonction de plusieurs paramètres :

- Historique des morceaux joués dans la soirée en cours
- Votes émis par les invités
- Suggestions musicales des invités
- Phase dramaturgique de la soirée (arrivée, ambiance, décollage, groove, party, fin)
- Caractéristiques musicales (BPM, genre, énergie, doctrine curative de l'Éditeur)

### 11.2. Absence d'effet juridique significatif

Cette recommandation musicale ne produit **aucun effet juridique** vous concernant et n'a **pas d'incidence significative** sur votre vie au sens de l'article 22 du RGPD. Elle n'entre donc pas dans le champ des décisions automatisées à caractère individuel encadrées par cet article.

### 11.3. Absence de profilage marketing

AhOuai n'effectue **aucun profilage à des fins commerciales, publicitaires ou de segmentation marketing**. Aucun score de solvabilité, de risque, de personnalité ou de préférences commerciales n'est calculé.

---

## 12. Modifications de la Politique de Confidentialité

L'Éditeur peut modifier la présente Politique à tout moment, notamment pour tenir compte d'évolutions du Service, réglementaires ou légales.

Les modifications substantielles sont notifiées :

- Par affichage d'une bannière dans l'Application lors du prochain lancement
- Par email pour les changements ayant un impact significatif sur vos droits (uniquement si vous avez fourni une adresse email)

La version en vigueur est celle disponible à l'adresse `https://ahouai.com/privacy` (URL à confirmer) et dans l'Application.

L'historique des versions est disponible sur simple demande à `contact@ahouai.com`.

---

## 13. Contact et réclamation

### 13.1. Contact de l'Éditeur

Pour toute question, demande d'exercice de droits, ou réclamation relative à la présente Politique :

- **Email** : `contact@ahouai.com`
- **Adresse postale** : [À COMPLÉTER avant publication]

L'Éditeur s'engage à répondre à votre demande dans les meilleurs délais, et au maximum dans un délai d'**un mois**.

### 13.2. Réclamation auprès de la CNIL

Si, malgré les efforts de l'Éditeur, vous estimez que vos droits ne sont pas respectés, vous avez le droit d'introduire une réclamation auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL) :

- **Adresse** : Commission Nationale de l'Informatique et des Libertés, 3 Place de Fontenoy, TSA 80715, 75334 Paris Cedex 07
- **Téléphone** : 01 53 73 22 22
- **Site web** : `www.cnil.fr`
- **Formulaire de plainte en ligne** : `www.cnil.fr/fr/plaintes`

Vous pouvez également saisir toute autre autorité de contrôle compétente au sein de l'Union européenne.

---

## 14. Version de la Politique

- **Version actuelle** : 1.0
- **Date d'entrée en vigueur** : [À COMPLÉTER]
- **Date de dernière mise à jour** : [À COMPLÉTER]

---

*Fin de la Politique de Confidentialité d'AhOuai — Version 1.0*
