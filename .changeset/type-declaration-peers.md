---
"@electron-spark/electron-builder-verification": patch
---

Exclude `@types/*` peer dependencies from automatic runtime package requirements so type-only peers such as react-intl's `@types/react` do not fail packaging verification.
