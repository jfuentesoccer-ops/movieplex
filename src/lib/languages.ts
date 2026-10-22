// Subtitle addons use ISO 639-2 codes (e.g. "eng"); a few use 639-1 or names.
const LANGS: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
  ita: 'Italian', por: 'Portuguese', pob: 'Portuguese (BR)', pt_br: 'Portuguese (BR)', rus: 'Russian',
  jpn: 'Japanese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese', ze: 'Chinese (bilingual)',
  zht: 'Chinese (traditional)', ara: 'Arabic', hin: 'Hindi', tur: 'Turkish', pol: 'Polish',
  dut: 'Dutch', nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish',
  gre: 'Greek', ell: 'Greek', heb: 'Hebrew', hun: 'Hungarian', cze: 'Czech', ces: 'Czech',
  rum: 'Romanian', ron: 'Romanian', bul: 'Bulgarian', hrv: 'Croatian', scc: 'Serbian', srp: 'Serbian',
  slv: 'Slovenian', slo: 'Slovak', slk: 'Slovak', ukr: 'Ukrainian', vie: 'Vietnamese', tha: 'Thai',
  ind: 'Indonesian', may: 'Malay', msa: 'Malay', per: 'Persian', fas: 'Persian', ben: 'Bengali',
  tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', est: 'Estonian', lav: 'Latvian', lit: 'Lithuanian',
  ice: 'Icelandic', isl: 'Icelandic', cat: 'Catalan', baq: 'Basque', eus: 'Basque', glg: 'Galician',
  alb: 'Albanian', sqi: 'Albanian', mac: 'Macedonian', mkd: 'Macedonian', bos: 'Bosnian', geo: 'Georgian',
  arm: 'Armenian', urd: 'Urdu', tgl: 'Tagalog', afr: 'Afrikaans', spn: 'Spanish (EU)', sme: 'Sami',
};

export const SUBTITLE_LANGUAGE_OPTIONS = [
  'eng', 'spa', 'fre', 'ger', 'ita', 'por', 'pob', 'rus', 'jpn', 'kor', 'chi', 'ara', 'hin', 'tur',
  'pol', 'dut', 'swe', 'nor', 'dan', 'fin', 'gre', 'heb', 'hun', 'cze', 'rum', 'ukr', 'vie', 'tha', 'ind',
];

const display = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    return null;
  }
})();

export function languageName(code: string) {
  const key = code?.toLowerCase();
  if (!key) return 'Unknown';
  if (LANGS[key]) return LANGS[key];
  try {
    const name = display?.of(key);
    if (name && name.toLowerCase() !== key) return name;
  } catch {
    // not a valid BCP-47 tag
  }
  return code;
}

/** Normalises a language code so 639-1/639-2 variants compare equal. */
export function sameLanguage(a: string, b: string) {
  return a && b && languageName(a) === languageName(b);
}
