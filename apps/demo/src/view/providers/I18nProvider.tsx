import { subscribeIpcState } from "@electron-spark/ipc/renderer";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IntlProvider } from "react-intl";

import { type Settings, settings } from "../../preload/settings";
import { en } from "../messages/en";
import { fr } from "../messages/fr";

const messages = { en, fr } satisfies Record<Settings["locale"], Record<keyof typeof en, string>>;

export const I18nProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [locale, setLocale] = useState<Settings["locale"]>();

  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    const subscription = subscribeIpcState({
      source: settings.state,
      update: (state) => {
        setLocale(state.locale);
        setFailed(false);
      },
      onError: () => setFailed(true),
    });
    retry.current = subscription.retry;
    return () => subscription.dispose();
  }, []);

  useEffect(() => {
    if (locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  if (!locale) {
    return (
      <div role={failed ? "alert" : "status"}>
        {failed ? "Unable to load language settings. Retrying…" : "Loading…"}
        {failed && <button onClick={() => retry.current()}>Retry now</button>}
      </div>
    );
  }

  return (
    <IntlProvider locale={locale} defaultLocale="en" messages={messages[locale]}>
      {children}
    </IntlProvider>
  );
};
