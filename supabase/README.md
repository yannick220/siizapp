# SIIZ + Supabase

Si le projet Supabase est déjà configuré, ne recréez pas la base pour `siizapp`.
Changez seulement l’URL du site dans `Authentication` puis `URL Configuration` :

- `https://yannick220.github.io/siizapp/`

Pour une première installation propre, exécuter les fichiers dans cet ordre depuis le `SQL Editor` de Supabase.

1. `schema.sql`
2. `02-live-setup.sql`

Le premier fichier crée les tables. Le deuxième ajoute les codes SIIZ, les règles de sécurité, les fonctions pour ajouter un contact par code, créer une conversation directe, créer un groupe et recevoir les messages en temps réel.

Si Supabase affiche une erreur parce qu'une règle existe déjà, ou si l'app affiche `Supabase à terminer`, utiliser plutôt :

1. `03-repair-complet.sql`

Ce fichier complet est relançable. Il répare une installation partielle et remet les règles de sécurité à jour.

La version fournie est déjà configurée dans `siiz-supabase-live.js` avec l'URL du projet Supabase et la clé publique.

Pour un projet déjà installé, `03-repair-complet.sql` est le chemin le plus simple.

## Ce que cette version couvre

- comptes email Supabase
- profil utilisateur
- code SIIZ personnel
- ajout d'un contact par code
- conversations directes
- création de groupes avec contacts SIIZ réels
- envoi et réception de messages
- proximité approximative arrondie côté client
- disparition des profils qui désactivent la proximité

## À prévoir avant production

- synchronisation réelle du carnet d'adresses téléphone
- stockage des avatars et messages audio
- notifications push
- suppression/export définitif des données
- chiffrement ou stratégie de sécurité documentée
- conformité RGPD, CGU et mentions légales définitives
