/** The product name in the page's language: Mahaam is the Arabic word مهام ("tasks"). */
export function brandName(locale: string | null | undefined): string {
  return locale === "ar" ? "مهام" : "Mahaam"
}
