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

type FeatureCardProps = {
  name: string;
  category: ReactNode;
  description: ReactNode;
  href: string;
  icon: LucideIcon;
};

const FeatureCard = ({
  name,
  category,
  description,
  href,
  icon: Icon,
}: FeatureCardProps): ReactNode => {
  const intl = useIntl();

  return (
    <article className={styles.feature}>
      <div className={styles.featureTop}>
        <Icon size={22} aria-hidden />
        <span className={styles.tag}>{category}</span>
      </div>

      <h3 className={styles.featureTitle}>{name}</h3>
      <p className={styles.featureDescription}>{description}</p>

      <a
        className={styles.link}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={intl.formatMessage(
          { defaultMessage: "Explore {name} documentation", id: "xj3azO" },
          { name },
        )}
      >
        <FormattedMessage defaultMessage="Explore the docs" id="6QQVXx" />
        <ArrowUpRight size={16} aria-hidden />
      </a>
    </article>
  );
};

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
            Electron Spark
          </div>
          <div className={styles.localeControl}>
            <select
              className={styles.localeSelect}
              aria-label={intl.formatMessage({ defaultMessage: "Language", id: "y1Z3or" })}
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
                <FormattedMessage
                  defaultMessage="Unable to change language. Please try again."
                  id="IBx7cd"
                />
                <FormattedMessage defaultMessage="hello world" id="MJ7MSJ" />
              </span>
            )}
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>
              <FormattedMessage defaultMessage="Your next desktop app" id="5xWQHT" />
            </p>
            <h1 className={styles.title}>
              <FormattedMessage
                defaultMessage="A little setup.<br></br>A lot of possibility."
                id="60/Im1"
                values={{ br: () => <br /> }}
              />
            </h1>
            <p className={styles.intro}>
              <FormattedMessage
                defaultMessage="Your Electron app is up and running.<br></br>Make yourself at home. Then make it yours."
                id="BBzRjg"
                values={{ br: () => <br /> }}
              />
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
              <FormattedMessage defaultMessage="Start making it yours" id="LvKKJd" />
            </h2>
            <p className={styles.startDescription}>
              <FormattedMessage
                defaultMessage="Edit <code>src/view</code> to change this screen."
                id="HaVVfJ"
                values={{ code: (chunks) => <code className={styles.code}>{chunks}</code> }}
              />
            </p>
          </div>
        </section>

        <section aria-labelledby="features-heading">
          <h2 id="features-heading" className={styles.sectionTitle}>
            <FormattedMessage defaultMessage="Explore what’s inside" id="PGYFB3" />
          </h2>

          <div className={styles.features}>
            <FeatureCard
              name="vanilla-extract"
              category={<FormattedMessage defaultMessage="Styling" id="kMsDUq" />}
              description={
                <FormattedMessage
                  defaultMessage="Give your app its own style. Write your styles in TypeScript."
                  id="KyJch2"
                />
              }
              href="https://vanilla-extract.style/"
              icon={Palette}
            />
            <FeatureCard
              name="TanStack Router"
              category={<FormattedMessage defaultMessage="Routing" id="kxSfEi" />}
              description={
                <FormattedMessage
                  defaultMessage="Every screen has a place. Build your app’s navigation with TanStack."
                  id="Eie3ps"
                />
              }
              href="https://tanstack.com/router/latest"
              icon={Signpost}
            />
            <FeatureCard
              name="React Intl"
              category={<FormattedMessage defaultMessage="Internationalization" id="/TKPkw" />}
              description={
                <FormattedMessage
                  defaultMessage="Make your app feel at home in every language. Translate messages and format dates and numbers with React Intl."
                  id="BqZd+l"
                />
              }
              href="https://formatjs.github.io/docs/react-intl/"
              icon={Languages}
            />
          </div>
        </section>

        <footer className={styles.footer}>
          <span>
            <FormattedMessage defaultMessage="Your idea. Your desktop app." id="Tx3Y+K" />
          </span>
          <span>Electron / Vite / React</span>
        </footer>
      </main>
    </div>
  );
};

export const Route = createFileRoute("/_electron-spark/")({
  component: Index,
});
