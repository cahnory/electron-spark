# electron-spark

Le dépôt utilise une racine privée `electron-spark-workspace`. Le package
[`electron-spark`](libs/electron-spark/README.md) est un placeholder publiable
qui oriente vers les packages `@electron-spark/*`, sans réexports ni dépendances.
Installer directement les packages nécessaires ; `vite-config` est une dépendance
de développement.

## Contrôles

Installer les dépendances avec `pnpm install`, puis lancer `pnpm check` depuis la
racine. La version de pnpm est fixée dans `packageManager`. Les tests utilisent
le support TypeScript natif de Node.js et les mocks de modules expérimentaux
(Node.js 24 recommandé).

| Commande            | Depuis la racine                                                 | Depuis un package                                                                |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm check`        | Tous les contrôles en parallèle, sorties regroupées par contrôle | Types, tests, lint et format du package en parallèle                             |
| `pnpm check:types`  | Tooling de tout le dépôt et sources de chaque package            | Sources du package ; tests de types pour IPC ; main, preload et vue pour la démo |
| `pnpm check:test`   | Tests des huit packages                                          | Tests du package                                                                 |
| `pnpm check:unused` | Analyse Knip de tout le workspace                                | Disponible uniquement à la racine                                                |
| `pnpm check:lint`   | Oxlint sur tout le dépôt, avertissements bloquants               | Oxlint sur le package                                                            |
| `pnpm check:format` | Oxfmt sur tout le dépôt                                          | Oxfmt sur le package                                                             |

Pour cibler un package depuis la racine :

```sh
pnpm --filter @electron-spark/ipc check
pnpm --filter @electron-spark/demo check:test
```

Le `tsconfig.json` racine couvre le tooling de tout le dépôt, y compris les
configurations Vite et tsdown des packages. Les configurations des projets
couvrent leurs sources ; IPC possède aussi une configuration pour ses tests de types.

Les outils sont installés à la racine et accessibles aux scripts des packages.
Lint et format parcourent déjà tout le dépôt : leurs commandes globales ne
relancent donc pas les mêmes analyses dans chaque package. Knip s'exécute une
seule fois afin de suivre les imports et exports entre packages. Sa configuration
reconnaît les points d'entrée Electron, preload et routes TanStack ; les exports
générés sont exclus des signalements d'exports inutilisés.

La démo possède sa configuration `apps/demo/.oxlintrc.json`, qui étend les règles
racine et charge `eslint-plugin-formatjs`, installé uniquement dans ses
`devDependencies`. Les commandes racine `check:lint` et `fix:lint` découvrent
automatiquement cette configuration ; ne pas leur passer `--config`, car cela
désactiverait les configurations imbriquées. Les règles FormatJS vérifient les
messages déclarés dans le code (placeholders, pluriels, espaces et offsets).
`formatjs/enforce-id` exige un `defaultMessage` littéral et génère un ID avec
`[sha512:contenthash:base64:6]`. L'extension Oxc applique cette correction à la
sauvegarde, ou via `pnpm fix:lint`. Les catalogues anglais et français utilisent
ces mêmes IDs ; les mettre à jour après une modification du texte source.
Les tests vérifient les hashes du catalogue anglais, la présence des traductions
et leur formatage. Le plugin ne vérifie pas directement les catalogues.

Les types et tests utilisent le graphe de tâches de pnpm 12 : par défaut, chaque
tâche attend la même tâche dans ses dépendances workspace. Les tâches prêtes
s'exécutent en parallèle, avec des sorties regroupées par package. `--no-bail`
permet aux branches indépendantes de terminer malgré un échec ; la commande
retourne un code non nul si un contrôle échoue. Aucun build préalable n'est
nécessaire, car les exports workspace pointent vers les sources TypeScript.
Si une future tâche nécessite un build, déclarer sa dépendance dans `tasks` de
`pnpm-workspace.yaml` ([documentation pnpm](https://pnpm.io/workspace-task-orchestration)).

Les anciennes commandes `test` et `typecheck`, lorsqu'elles existaient, restent
disponibles comme alias des nouveaux scripts.

Les tests affichent un résumé par package en cas de succès et le rapport détaillé
en cas d’échec. Pour une sortie détaillée à la demande, lancer Node avec
`--test-reporter=spec` à la place du reporter partagé.

## Builds et distributions sécurisées

Depuis `apps/demo`, `pnpm build:dist` compile uniquement l'application. `pnpm build`
exécute les contrôles, compile puis produit une distribution signée. Le packaging
échoue sans signature ; sur macOS, les identifiants de notarisation sont également
obligatoires et le ticket agrafé est vérifié après signature. Configurer les
certificats de signature electron-builder via le trousseau ou `CSC_LINK` et
`CSC_KEY_PASSWORD` (et les équivalents Windows si nécessaire). Ne jamais placer
ces fichiers ou valeurs dans `src`, `public`, `resources` ou les artefacts.

Pour développer une application utilisée uniquement en local, `pnpm build:local`
produit l'application dépaquetée dans `release/local/<version>`, sans exiger de
certificat de distribution ni de notarisation. Sur macOS, une signature ad hoc
locale est appliquée pour permettre l'exécution, notamment sur Apple Silicon.
Sous Windows, la signature est facultative et peut être appliquée si des
identifiants sont déjà configurés. Les contrôles des fichiers, les fuses et les
protections de production restent actifs. `pnpm build` conserve la signature
obligatoire et les sorties de distribution séparées.

Pour la notarisation macOS, fournir un des ensembles suivants :

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` ;
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` ;
- `APPLE_KEYCHAIN_PROFILE` et éventuellement `APPLE_KEYCHAIN`.

Le main et les preloads embarquent leurs dépendances dans leurs bundles. Le
package exclut `node_modules`, les sources TypeScript et les source maps. Un hook
inspecte aussi le contenu réel de `app.asar` et refuse les fichiers hors de
`dist`, les extensions non prévues, les fichiers cachés, les fichiers de secrets
identifiables et les fichiers dépaquetés. L'ajout de modules natifs ou de nouveaux
types de ressources nécessite une adaptation explicite de cette politique, avec
vérification de l'artefact final. Les fichiers de `src/resources` sont copiés dans
`dist/main/resources` en développement et en production, puis inclus dans ASAR.
Le main peut les lire via `RESOURCES_PATH` (dans `src/main/constants.ts`). Les
ressources peuvent avoir toute extension, sauf les sources TypeScript, source maps
et certificats/clés privés exclus par la politique de packaging. Elles sont en
lecture seule ; conserver les données modifiables dans un répertoire adapté.
Ce répertoire est bloqué par le serveur HTTP de développement.

La publication est désactivée (`publish: null` et `--publish never`). Avant
l'ajout d'un updater ou d'une publication, définir explicitement l'identité de
l'application, son dépôt et son fournisseur de mises à jour ; adapter également
le hook qui refuse `app-update.yml`. Ne pas publier tout le dossier `release` :
il peut contenir d'anciens artefacts et des fichiers de diagnostic. Distribuer
uniquement les installateurs vérifiés du build concerné.

Les fuses désactivent RunAsNode, les options Node par environnement et l'inspecteur
Node ; ils activent le chiffrement des cookies et le chargement exclusif depuis
un ASAR dont l'intégrité est validée. Utiliser `utilityProcess` plutôt que
`child_process.fork` pour les futurs processus Node auxiliaires.

Les builds de production refusent les options de fenêtre qui désactivent
l'isolation, le sandbox ou la sécurité web, et celles qui activent Node dans les
renderers ou des fonctionnalités expérimentales. La CSP de production ne permet
pas les scripts/styles inline ; les exceptions nécessaires à Vite/React sont
ajoutées uniquement par le serveur de développement. Ajouter explicitement les
origines autorisées à `connect-src` si l'application utilise un service distant.

Tout code distribué, y compris le main et les preloads, est lisible par
l'utilisateur. ASAR et `.gitignore` ne protègent pas les secrets : aucun secret
serveur ne doit être intégré au code, aux assets ou à `VITE_*`. Le contrôle des
noms de fichiers ne remplace pas une revue de leur contenu. Conserver les secrets
serveur côté serveur et les identifiants de release dans le gestionnaire de
secrets du CI ; installer avec `pnpm install --frozen-lockfile` dans un checkout
propre et maintenir Electron et les dépendances à jour.

Les applications packagées ignorent `MODE=test`. Les sessions Electron refusent
les permissions par défaut ; les exceptions se déclarent dans
`configureSessionPermissions` avec une origine HTTP(S) exacte et les permissions
nécessaires, uniquement pour la frame principale. Cette politique est installée
avant la création des fenêtres, pour la session par défaut et les nouvelles sessions.

Chaque renderer compilé reçoit une CSP restrictive si elle manque. Une CSP
existante doit limiter les scripts à `self`, des hashes ou des nonces, interdire
les objets et restreindre `base-uri`. Elle est réappliquée au début du head.
Les ressources supplémentaires sont refusées sauf les fichiers Electron
explicitement autorisés ; les répertoires de traduction macOS doivent être vides.

Pour imposer l'identité du signataire, définir `EXPECTED_APPLE_TEAM_ID` (10 caractères)
et/ou `EXPECTED_WINDOWS_PUBLISHER` (sujet exact du certificat Authenticode).
Après création des artefacts, les signatures des DMG sont vérifiées ; pour les ZIP
macOS, la signature et le ticket de notarisation de l'application extraite sont
vérifiés ; les installateurs
Windows doivent avoir une signature Authenticode valide. Les builds locaux
conservent leur exemption de vérification des signatures de distribution.
Les releases Windows doivent être construites sur Windows (poste ou runner CI),
où PowerShell vérifie Authenticode. Un contrôle `beforePack` refuse les releases
Windows depuis macOS ou Linux avant le packaging ; les builds locaux dépaquetés
restent possibles avec `build:local`.
