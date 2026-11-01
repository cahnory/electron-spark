import { useEffect, useState, type ReactNode } from "react";
import { IntlProvider } from "react-intl";

import type { Settings } from "../../main/settings.ts";
import { en } from "../messages/en";
import { fr } from "../messages/fr";
import { settings } from "../preload";

const messages = { en, fr } satisfies Record<Settings["locale"], Record<keyof typeof en, string>>;

export const I18nProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [locale, setLocale] = useState<Settings["locale"]>();

  useEffect(
    () =>
      settings.state.subscribe(
        (state) => setLocale(state.locale),
        (error) => console.error("Unable to synchronize language settings", error),
      ),
    [],
  );

  useEffect(() => {
    if (locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  if (!locale) {
    return null;
  }

  return (
    <IntlProvider locale={locale} defaultLocale="en" messages={messages[locale]}>
      {children}
    </IntlProvider>
  );
};
