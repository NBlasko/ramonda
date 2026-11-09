---
title: Translations
description: An app in more than one language — the words in a dictionary per language, the language in a context, plurals and dates the way each language writes them.
section: Across the app
order: 120
---

# Translations

**An app in more than one language needs four things:** the words of each language kept in one
place, the current language reachable from any component, plural forms and dates written the way
that language writes them, and `<html lang>` saying which language the page is in. Ramonda has no
translation package; each of the four is a few lines of ordinary code, and this page is those lines.

## The words: a dictionary per language

One object per language, each of the same shape. The type is what keeps them in step: a key added to
one language and forgotten in another is a type error, found before anyone switches language.

```ts
type Locale = "en" | "sr-Latn";

/** A word that changes with the count: `other` always, and whichever forms the language has. */
type Plural = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

interface Messages {
  title: string;
  switchLanguage: string;
  matches: Plural;
}

const messages: Record<Locale, Messages> = {
  en: {
    title: "Matches",
    switchLanguage: "Srpski",
    matches: { one: "{n} match", other: "{n} matches" },
  },
  "sr-Latn": {
    title: "Utakmice",
    switchLanguage: "English",
    matches: { one: "{n} utakmica", few: "{n} utakmice", other: "{n} utakmica" },
  },
};

const rules = new Map<Locale, Intl.PluralRules>();

/** The form `n` takes in this language, with `n` written in. */
function plural(locale: Locale, forms: Plural, n: number): string {
  let rule = rules.get(locale);
  if (rule === undefined) {
    rule = new Intl.PluralRules(locale);
    rules.set(locale, rule);
  }
  return (forms[rule.select(n)] ?? forms.other).replace("{n}", String(n));
}
```

**The key is a language tag, and it names the script when a language has two.** Serbian is written
in both: `sr` is Cyrillic and `sr-Latn` Latin, and `Intl` below writes a month's name in the script the
tag says — so a dictionary in Latin goes with `sr-Latn`, and so does `<html lang>`.

**Plurals are not "one or many".** English has two forms; Serbian has three — 1 *utakmica*,
2 *utakmice*, 5 *utakmica* — and other languages have up to six. `Intl.PluralRules` knows which form
a number takes in each language, so the dictionary names the forms and the code never counts.

## The language: a context

The current language is needed all over the app and changes from one place, which is what a
[context](/composition/context) is for. The component at the top holds it in `@state` and provides
it; [`Head`](/ssr/head#the-pages-language-lang-and-dir) puts it on `<html lang>`, which is what a
screen reader picks its pronunciation from:

```tsx
import { Component, Head, createContext, state } from "@ramonda/core";

const [LanguageProvider, LanguageConsumer] = createContext({ locale: "en" as Locale });

class App extends Component {
  @state locale: Locale = "en";
  language = this.use(LanguageProvider, (self: App) => ({ locale: self.locale }));
  head = this.use(Head, (self: App) => ({ lang: self.locale, title: messages[self.locale].title }));

  toggle() {
    this.locale = this.locale === "en" ? "sr-Latn" : "en";
  }

  render() {
    return (
      <main>
        <button onclick={this.toggle}>{messages[this.locale].switchLanguage}</button>
        <MatchCount count={3} />
      </main>
    );
  }
}
```

A component below reads the language from the context and looks its words up:

```tsx
class MatchCount extends Component<{ count: number }> {
  language = this.use(LanguageConsumer);

  render() {
    const { locale } = this.language;
    return <p>{plural(locale, messages[locale].matches, this.props.count)}</p>;
  }
}
```

Reading `this.language.locale` is what makes the switch reach it: a component that reads a key of a
context re-renders when that key changes, and one that never reads it is left alone.

## Numbers and dates: `Intl`, with the language named

`Intl.NumberFormat` and `Intl.DateTimeFormat` write a number or a date the way a language does —
`1,234.5` in English, `1.234,5` in Serbian. Name the language and, for a date, the time zone:

```ts
function price(locale: Locale, euros: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(euros);
}

function day(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Belgrade" }).format(date);
}
```

Left out, both come from the machine the code runs on. On a server-rendered page that is two
machines — the server's settings and the reader's — and the page the server sent is not the page the
browser draws. That is a [hydration mismatch](/ssr/mismatches), and naming both is how it is avoided.

## Remembering the choice

`@state` lasts as long as the page. To keep the reader's choice past a reload, keep it where the next
visit finds it before anything renders — in the address, or in a cookie.

**A choice kept in the browser is not enough on a page baked at build time.** Every reader gets the same
file, so a reader who chose English is sent the page in Serbian, and the switch after hydration is a
flash on every load. The answer is to make each language its own page.

### One route per language

The language is the first segment of the address — `/en/matches`, `/sr-Latn/matches` — and the
component above the outlet reads it from the path:

```tsx
import { Component, Head, compute, createContext } from "@ramonda/core";
import { createRoutes, createRouter } from "@ramonda/router";

const routes = createRoutes({ "/:lang/matches": <MatchCount count={3} /> });
const { Router, RouteOutlet, Navigator } = createRouter(routes);
const [LanguageProvider] = createContext({ locale: "en" as Locale });

class App extends Component {
  router = this.use(Router);
  route = this.use(Navigator);
  language = this.use(LanguageProvider, (self: App) => ({ locale: self.locale }));
  head = this.use(Head, (self: App) => ({ lang: self.locale, link: self.alternates }));

  /** The first segment, when it is a language this app has. */
  @compute get locale(): Locale {
    return this.route.pathname.startsWith("/sr-Latn/") ? "sr-Latn" : "en";
  }

  /** The same page in every language, for a search engine: `<link rel="alternate" hreflang>`. */
  @compute get alternates() {
    const rest = this.route.pathname.replace(/^\/[^/]+/, "");
    return (["en", "sr-Latn"] as const).map((lang) => ({ rel: "alternate", hreflang: lang, href: `/${lang}${rest}` }));
  }

  render() {
    return <RouteOutlet routes={routes} />;
  }
}
```

Each language is then a page of its own: baked at build in that language, linked to, and found by a
search engine in it. Mark the route `prerender: true` in `src/entry-server.tsx` and list the pages in
`PRERENDER_PATHS` — `["/en/matches", "/sr-Latn/matches"]` — and switching language is a link to the same
page under the other segment. A host serving only files cannot read a reader's settings, so `/` itself is
the default language's page, or a link to each.

**With a server, a cookie works too**, read through [`requestContext()`](/ssr/request): the first HTML is
already in the reader's language. A page that reads the request is rendered for each request, though,
and cannot be baked.

## Words inside the page that are in another language

A quotation, a name, a word left untranslated: give it its own `lang`, so it is read in that language
rather than the page's.

```tsx
<p>
  The motto is <q lang="la">citius, altius, fortius</q>.
</p>
```

## Form messages

A field's error messages come from its validators, and they carry a key for the failure as well as
the text. [Translating the messages](/forms/validation#translating-the-messages) maps that key
through the dictionary.

## Next

- [Context](/composition/context) — what a consumer re-renders for, and the order `use()` calls take.
- [`Head`](/ssr/head) — the title, the description and `lang`, from the component that knows them.
- [Hydration mismatches](/ssr/mismatches) — the other values that differ between a server and a browser.
