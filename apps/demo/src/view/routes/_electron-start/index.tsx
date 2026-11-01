import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  FolderCode,
  Languages,
  Orbit,
  Palette,
  Signpost,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import visual from "../../assets/visual.png?url";
import { settings } from "../../preload";

import * as styles from "./index.css";

type Feature = {
  name: string;
  category: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const features: Feature[] = [
  {
    name: "vanilla-extract",
    category: "home.features.styling.category",
    description: "home.features.styling.description",
    href: "https://vanilla-extract.style/",
    icon: Palette,
  },
  {
    name: "TanStack Router",
    category: "home.features.routing.category",
    description: "home.features.routing.description",
    href: "https://tanstack.com/router/latest",
    icon: Signpost,
  },
  {
    name: "React Intl",
    category: "home.features.i18n.category",
    description: "home.features.i18n.description",
    href: "https://formatjs.github.io/docs/react-intl/",
    icon: Languages,
  },
];

const Index = (): ReactNode => {
  const intl = useIntl();
  const [localeError, setLocaleError] = useState(false);
  const [changingLocale, setChangingLocale] = useState(false);
  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Orbit className={styles.accent} size={22} aria-hidden />
            Electron Start
          </div>
          <div className={styles.localeControl}>
            <select
              className={styles.localeSelect}
              aria-label={intl.formatMessage({ id: "home.locale.label" })}
              value={intl.locale}
              disabled={changingLocale}
              onChange={async (event) => {
                const locale = event.currentTarget.value;
                if (locale !== "en" && locale !== "fr") return;
                setLocaleError(false);
                setChangingLocale(true);
                try {
                  await settings.api.setLocale(locale);
                } catch {
                  setLocaleError(true);
                } finally {
                  setChangingLocale(false);
                }
              }}
            >
              <option value="en" lang="en">
                English
              </option>
              <option value="fr" lang="fr">
                Français
              </option>
            </select>
            {localeError && (
              <span className={styles.localeError} role="alert">
                <FormattedMessage id="home.locale.error" />
              </span>
            )}
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>
              <FormattedMessage id="home.eyebrow" />
            </p>
            <h1 className={styles.title}>
              <FormattedMessage id="home.title" values={{ br: () => <br /> }} />
            </h1>
            <p className={styles.intro}>
              <FormattedMessage id="home.intro" values={{ br: () => <br /> }} />
            </p>
          </div>

          <div className={styles.art} aria-hidden>
            <img src={visual} className={styles.visual} />
          </div>
        </section>

        <section className={styles.start}>
          <FolderCode className={styles.startIcon} size={24} aria-hidden />
          <div>
            <h2 className={styles.startTitle}>
              <FormattedMessage id="home.start.title" />
            </h2>
            <p className={styles.startDescription}>
              <FormattedMessage
                id="home.start.description"
                values={{ code: (chunks) => <code className={styles.code}>{chunks}</code> }}
              />
            </p>
          </div>
        </section>

        <section aria-labelledby="features-heading">
          <h2 id="features-heading" className={styles.sectionTitle}>
            <FormattedMessage id="home.features.title" />
          </h2>

          <div className={styles.features}>
            {features.map(({ name, category, description, href, icon: Icon }) => (
              <article key={name} className={styles.feature}>
                <div className={styles.featureTop}>
                  <Icon size={22} aria-hidden />
                  <span className={styles.tag}>
                    <FormattedMessage id={category} />
                  </span>
                </div>

                <h3 className={styles.featureTitle}>{name}</h3>
                <p className={styles.featureDescription}>
                  <FormattedMessage id={description} />
                </p>

                <a
                  className={styles.link}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={intl.formatMessage({ id: "home.docs.label" }, { name })}
                >
                  <FormattedMessage id="home.docs" />
                  <ArrowUpRight size={16} aria-hidden />
                </a>
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <span>
            <FormattedMessage id="home.footer" />
          </span>
          <span>Electron / Vite / React</span>
        </footer>
      </main>
    </div>
  );
};

export const Route = createFileRoute("/_electron-start/")({
  component: Index,
});
