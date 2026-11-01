import type { en } from "./en";

export const fr: Record<keyof typeof en, string> = {
  "home.locale.label": "Langue",
  "home.locale.error": "Impossible de changer de langue. Réessayez.",
  "home.eyebrow": "Votre prochaine application de bureau",
  "home.title": "Un peu de préparation.<br></br>Beaucoup de possibilités.",
  "home.intro":
    "Votre application Electron est prête.<br></br>Installez-vous. Puis créez à votre image.",
  "home.start.title": "À vous de jouer",
  "home.start.description": "Modifiez <code>src/view</code> pour personnaliser cet écran.",
  "home.features.title": "Découvrez ce qui vous attend",
  "home.features.styling.category": "Styles",
  "home.features.styling.description":
    "Donnez du style à votre application. Écrivez vos styles en TypeScript.",
  "home.features.routing.category": "Navigation",
  "home.features.routing.description":
    "Chaque écran a sa place. Créez la navigation de votre application avec TanStack.",
  "home.features.i18n.category": "Internationalisation",
  "home.features.i18n.description":
    "Votre application parle toutes les langues. Traduisez les messages et adaptez les dates et les nombres avec React Intl.",
  "home.docs": "Consulter la documentation",
  "home.docs.label": "Consulter la documentation de {name}",
  "home.footer": "Votre idée. Votre application de bureau.",
};
