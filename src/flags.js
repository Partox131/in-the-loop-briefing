// Country flags for state-affiliated sources (Amir, 23 Nov 2026): a source
// funded or run by a state shows that state's flag next to its "state" label.
// Sources carry a two-letter "country" code (ISO 3166-1) in news.sources.json
// and voices.example.json; the region a source is based in is the fallback.
// The flag images are public/flags/<code>.svg (flag-icons, MIT licence).

/** Region names used in the source files -> country code. */
const REGION_CODE = {
  China: 'CN', France: 'FR', Germany: 'DE', Iran: 'IR', Israel: 'IL', Qatar: 'QA', Russia: 'RU',
  'Saudi Arabia': 'SA', Singapore: 'SG', 'South Korea': 'KR', Taiwan: 'TW', Turkey: 'TR', 'Türkiye': 'TR',
  UAE: 'AE', Ukraine: 'UA', US: 'US',
};

/** Codes we ship a flag image for. */
export const FLAGS = new Set(['AE', 'CN', 'DE', 'FR', 'IL', 'IR', 'KR', 'QA', 'RU', 'SA', 'SG', 'TR', 'TW', 'UA', 'US']);

/** The country whose state a source is affiliated with, or undefined. */
export function stateCountry(v) {
  if (!v?.stateAffiliated) return undefined;
  const code = String(v.country || REGION_CODE[v.region] || '').toUpperCase();
  return FLAGS.has(code) ? code : undefined;
}
