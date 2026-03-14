import { Button, InlineStack } from "@shopify/polaris";
import { useTranslation } from "../i18n/i18nContext";
import type { Locale } from "../i18n/i18nContext";

export function LanguageToggle() {
  const { locale, setLocale } = useTranslation();

  const options: { value: Locale; label: string }[] = [
    { value: "en", label: "EN" },
    { value: "ja", label: "JA" },
  ];

  return (
    <InlineStack gap="100" blockAlign="center">
      {options.map((option) => (
        <Button
          key={option.value}
          size="slim"
          variant={locale === option.value ? "primary" : "secondary"}
          onClick={() => setLocale(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </InlineStack>
  );
}
