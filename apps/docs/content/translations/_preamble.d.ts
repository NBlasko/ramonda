// What the translation examples may assume: the dictionary module and the context pair the page
// builds in its first two blocks, declared once so each block stays its own module.
export {};

declare global {
  type Locale = "en" | "sr-Latn";
  type Plural = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
  interface Messages {
    title: string;
    switchLanguage: string;
    matches: Plural;
  }
  const messages: Record<Locale, Messages>;
  function plural(locale: Locale, forms: Plural, n: number): string;

  class LanguageProvider extends Hook<{ locale: Locale }> {}
  class LanguageConsumer extends Hook<any> {
    locale: Locale;
  }

  class MatchCount extends Component<{ count: number }> {
    [key: string]: any;
    render(): any;
  }
}
