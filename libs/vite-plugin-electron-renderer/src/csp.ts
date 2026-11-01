import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { HtmlTagDescriptor } from "vite";

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';";

const validScript = (source: string) =>
  source === "'self'" ||
  source === "'none'" ||
  /^'(?:sha(?:256|384|512)-[A-Za-z0-9+/=]+|nonce-[A-Za-z0-9+/_=-]+)'$/.test(source);

/** Insert a safe default or reject policies that weaken script execution. */
export function productionCsp(html: string): HtmlTagDescriptor[] {
  const policies: string[] = [];
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "meta") {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (attrs["http-equiv"]?.toLowerCase() === "content-security-policy")
        policies.push(attrs.content ?? "");
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  for (const value of policies) {
    const directives = new Map<string, string[]>();
    for (const directive of value.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
    }
    const scripts = directives.get("script-src") ?? directives.get("default-src");
    if (
      !scripts?.length ||
      !scripts.every(validScript) ||
      ["script-src-elem", "script-src-attr"].some(
        (name) => directives.has(name) && !directives.get(name)!.every(validScript),
      ) ||
      directives.get("object-src")?.join(" ") !== "'none'" ||
      !directives.get("base-uri")?.every((source) => source === "'none'" || source === "'self'")
    ) {
      throw new Error(
        "Production renderer CSP must restrict scripts to self, hashes or nonces, set object-src 'none', and restrict base-uri to self or none.",
      );
    }
  }
  // Reapply existing policies before other head elements so early scripts are covered.
  return (policies.length ? policies : [policy]).map((content) => ({
    tag: "meta",
    attrs: { "http-equiv": "Content-Security-Policy", content },
    injectTo: "head-prepend",
  }));
}
