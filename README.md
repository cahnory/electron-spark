# electron-start

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
pnpm --filter @electron-start/ipc check
pnpm --filter @electron-start/demo check:test
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
