import { globalStyle, style, createTheme } from "@vanilla-extract/css";

const [theme, vars] = createTheme({
  color: {
    background: "light-dark(#f8fafb, #111719)",
    panel: "light-dark(#ffffff, #192225)",
    text: "light-dark(#203237, #e8f1f2)",
    secondary: "light-dark(#61757c, #9eb1b7)",
    border: "light-dark(#dde7e9, #2c3b40)",
    accent: "light-dark(#007e88, #71dde2)",
    accentSoft: "light-dark(#eaf4f5, #22383c)",
    orbit: "light-dark(#78bac3, #44828b)",
    glow: "light-dark(#daf2f3, #203f43)",
    halo: "light-dark(#dff1f2, #20383b)",
  },
});

export const page = style([
  theme,
  {
    colorScheme: "light dark",
    minHeight: "100svh",
    background: vars.color.background,
    color: vars.color.text,
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    WebkitFontSmoothing: "antialiased",
  },
]);

globalStyle(`:where(${page}, ${page} *)`, {
  boxSizing: "border-box",
});

globalStyle(`:where(html:has(${page}))`, {
  background: "#f8fafb",
  display: "flex",
  flexDirection: "column",
  fontSize: [`${(10 / 16) * 100}%`, `${10 / 16}em`],
  height: "100%",
});

globalStyle(`:where(body:has(${page}))`, {
  display: "flex",
  flexDirection: "column",
  flexGrow: 1,
  fontSize: "1.6rem",
  margin: 0,
});

globalStyle(`:where(${page} a)`, {
  textUnderlineOffset: "0.2ex",
});

export const container = style({
  maxWidth: 900,
  marginInline: "auto",
  padding: "32px 44px 28px",

  "@media": {
    "(max-width: 600px)": {
      padding: 24,
    },
  },
});

export const accent = style({
  color: vars.color.accent,
});

export const brand = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 14,
  fontWeight: 650,
  letterSpacing: "-0.3px",
});

export const hero = style({
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr",
  alignItems: "center",
  gap: 24,
  paddingBlock: "56px 32px",

  "@media": {
    "(max-width: 600px)": {
      gridTemplateColumns: "1fr",
      paddingTop: 32,
    },
  },
});

export const eyebrow = style({
  margin: 0,
  color: vars.color.accent,
  fontSize: "1.1rem",
  fontWeight: 650,
  letterSpacing: 2,
  textTransform: "uppercase",
});

export const title = style({
  margin: "16px 0 18px",
  fontSize: "clamp(3.2rem, 5vw, 4.8rem)",
  fontWeight: 600,
  lineHeight: 1.08,
  letterSpacing: "-2px",
});

export const intro = style({
  maxWidth: 400,
  margin: 0,
  color: vars.color.secondary,
  fontSize: "1.5rem",
  lineHeight: 1.7,
});

export const art = style({
  position: "relative",
  display: "grid",
  placeItems: "center",
  height: 230,
  background: `radial-gradient(ellipse, ${vars.color.glow}, transparent 69%)`,

  "@media": {
    "(max-width: 600px)": {
      display: "none",
    },
  },
});

export const visual = style({
  display: "block",
  width: "100%",
  height: "auto",
});

export const start = style({
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "20px 22px",
  background: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  borderLeft: `3px solid ${vars.color.accent}`,
  borderRadius: 12,
});

export const startIcon = style([
  accent,
  {
    flexShrink: 0,
  },
]);

export const startTitle = style({
  margin: 0,
  fontSize: "1.4rem",
  fontWeight: 600,
});

export const startDescription = style({
  margin: "6px 0 0",
  color: vars.color.secondary,
  fontSize: "1.3rem",
  lineHeight: 1.6,
});

export const code = style({
  padding: "3px 6px",
  borderRadius: 5,
  background: vars.color.accentSoft,
  color: vars.color.accent,
  fontFamily: "ui-monospace, monospace",
  fontSize: "1.3rem",
});

export const sectionTitle = style({
  margin: "38px 0 15px",
  color: vars.color.secondary,
  fontSize: "1.1rem",
  fontWeight: 600,
  letterSpacing: 1.6,
  textTransform: "uppercase",
});

export const features = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: 16,
});

export const feature = style({
  display: "flex",
  flexDirection: "column",
  padding: 22,
  background: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  borderRadius: 12,
});

export const featureTop = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  color: vars.color.accent,
});

export const tag = style({
  padding: "3px 8px",
  border: `1px solid ${vars.color.border}`,
  borderRadius: 5,
  color: vars.color.secondary,
  fontSize: 11,
});

export const featureTitle = style({
  margin: "19px 0 8px",
  fontSize: "1.6rem",
  fontWeight: 600,
  letterSpacing: "-0.3px",
});

export const featureDescription = style({
  margin: "0 0 20px",
  color: vars.color.secondary,
  fontSize: "1.3rem",
  lineHeight: 1.6,
});

export const link = style({
  display: "inline-flex",
  alignItems: "center",
  alignSelf: "flex-start",
  gap: 6,
  marginTop: "auto",
  color: vars.color.accent,
  fontSize: "1.2rem",
  textDecoration: "none",

  ":hover": {
    textDecoration: "underline",
  },

  ":focus-visible": {
    outline: `2px solid ${vars.color.accent}`,
    outlineOffset: 4,
    borderRadius: 2,
  },
});

export const footer = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 30,
  paddingTop: 18,
  borderTop: `1px solid ${vars.color.border}`,
  color: vars.color.secondary,
  fontSize: "1.1rem",
});

export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 16,
});

export const localeControl = style({
  marginLeft: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 6,
});

export const localeSelect = style({
  padding: "8px 10px",
  border: `1px solid ${vars.color.border}`,
  borderRadius: 8,
  background: vars.color.panel,
  color: vars.color.text,
  font: "inherit",
  fontSize: 13,
  cursor: "pointer",
  ":focus-visible": {
    outline: `2px solid ${vars.color.accent}`,
    outlineOffset: 3,
  },
  ":disabled": {
    cursor: "wait",
    opacity: 0.6,
  },
});

export const localeError = style({
  color: vars.color.secondary,
  fontSize: 12,
});
