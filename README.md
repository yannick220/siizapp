# SIIZ

PWA installable de SIIZ, branchée sur Supabase.

SIIZ est une messagerie qui compare les distances sans afficher la position exacte. Cette version gère les comptes, profils, contacts par code, conversations, groupes et messages avec Supabase.

## Ce que contient le paquet

- `index.html` : l'application complète, prête à publier.
- `siiz-supabase-live.js` : connexion Supabase, comptes, codes SIIZ, messages et groupes réels.
- `manifest.webmanifest` : installation PWA Android et compatibilité iOS.
- `sw.js` : service worker pour cache et ouverture hors ligne.
- `offline.html` : écran hors ligne.
- `icons/` : icônes d'application.
- `supabase/schema.sql` : premier schéma Supabase.
- `supabase/02-live-setup.sql` : fonctions et règles à ajouter après le premier schéma.
- `capacitor/capacitor.config.json` : configuration pour emballer la PWA en app Android/iOS.
- `.nojekyll` : compatibilité GitHub Pages.

## Publier avec GitHub Pages

1. Créer un nouveau dépôt GitHub appelé `siizapp`.
2. Envoyer tous les fichiers de ce dossier à la racine du dépôt.
3. Dans GitHub : `Settings` puis `Pages`.
4. Source : `Deploy from a branch`.
5. Branch : `main`, folder : `/root`.
6. Ouvrir `https://yannick220.github.io/siizapp/`.

Ce nouveau nom de dépôt donne une nouvelle adresse, séparée de l’ancienne PWA `siiz`. Android ne doit donc plus la confondre avec l’application déjà installée.

Sur Android, Chrome proposera l'installation. Sur iPhone, ouvrir dans Safari puis `Partager` et `Sur l'écran d'accueil`.

## Tester en local

Ouvrir directement `index.html` fonctionne pour vérifier l’interface. L’installation PWA exige une URL HTTPS ou un serveur local.

Avec Node :

```bash
npm install
npm run serve
```

## Supabase

L'app est déjà configurée avec :

- URL projet : `https://xctoczjnlvxbnlocwkpt.supabase.co`
- clé publique : dans `siiz-supabase-live.js`

À faire dans Supabase :

1. Garder le même projet Supabase.
2. `Authentication` puis `URL Configuration` : mettre `https://yannick220.github.io/siizapp/` en `Site URL`.
3. Ajouter aussi `https://yannick220.github.io/siizapp/` dans les URL de redirection autorisées si Supabase le propose.
4. `Authentication` puis `Providers` : vérifier que Email est activé.

Si le projet Supabase existe déjà ou si une exécution SQL s'est arrêtée avec une erreur, exécuter seulement `supabase/03-repair-complet.sql`. Ce script répare les tables, les fonctions et les règles sans bloquer sur les éléments déjà créés.

Dans l'app :

1. Créer un compte avec email et mot de passe.
2. Confirmer l'email si Supabase le demande.
3. Se reconnecter.
4. Ouvrir `Profil`, puis `Compte SIIZ`, pour copier son code SIIZ.
5. Sur un autre compte, ouvrir `+`, puis `Ajouter par code SIIZ`.

La session reste enregistrée : l'écran de compte ne réapparaît pas tant que l'utilisateur ne se déconnecte pas volontairement. Dans `Mon profil` puis `Confidentialité`, couper `Proximité SIIZ` efface la zone approximative, retire l'utilisateur de l'échelle des autres et masque les profils SIIZ sur son propre écran jusqu'à réactivation.

Important : la clé présente dans le navigateur est une clé publique Supabase. Ne jamais mettre la clé `service_role` dans GitHub ou dans le HTML.

## Transformer en vraie application mobile

La voie la plus simple est Capacitor :

```bash
npm install
npm run cap:init
npm run cap:add:android
npm run cap:add:ios
npm run cap:sync
```

Ensuite :

- Android : ouvrir le projet dans Android Studio, générer l'APK ou l'AAB.
- iOS : ouvrir le projet dans Xcode, compte Apple Developer nécessaire.

## Modules à compléter

- vraie synchronisation du carnet d'adresses téléphone
- stockage médias et messages audio
- notifications push
- chiffrement ou stratégie de sécurité documentée
- modération et signalements réels
- textes juridiques définitifs
