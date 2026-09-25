/** Copy dictionaries for the Qomicex brand surfaces. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  brandName: 'Qomicex',
} satisfies Record<string, string>

/** Brand surface locale key union. */
export type QomicexBrandLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  brandName: 'Qomicex',
} satisfies Record<QomicexBrandLocaleKey, string>
