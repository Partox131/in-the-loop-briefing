// Places outside North America, for telling whose politics a story is about.
// A US politics story that names one of these (the UK, Venice) must also name
// something unmistakably American, or it stays out of the US segment: "Net
// migration to UK falls" is not US immigration news. See `abroad` and `home`
// in src/hierarchy.js. Lowercase terms, matched on word boundaries.

export const WORLD = [
  // Europe
  'uk', 'u.k.', 'britain', 'british', 'great britain', 'england', 'english channel', 'scotland', 'scottish', 'wales', 'welsh', 'northern ireland',
  'london', 'westminster', 'downing street', 'starmer', 'reform uk', 'farage', 'badenoch', 'labour party', 'home office', 'nhs',
  'ireland', 'irish', 'dublin', 'france', 'french', 'paris', 'macron', 'germany', 'german', 'berlin', 'bundestag', 'merz',
  'italy', 'italian', 'rome', 'milan', 'venice', 'meloni', 'spain', 'spanish', 'madrid', 'barcelona', 'portugal', 'portuguese', 'lisbon',
  'netherlands', 'dutch', 'amsterdam', 'the hague', 'belgium', 'belgian', 'brussels', 'switzerland', 'swiss', 'geneva', 'zurich', 'austria', 'austrian', 'vienna',
  'sweden', 'swedish', 'stockholm', 'norway', 'norwegian', 'oslo', 'denmark', 'danish', 'copenhagen', 'finland', 'finnish', 'helsinki', 'iceland',
  'poland', 'polish', 'warsaw', 'czech', 'prague', 'hungary', 'hungarian', 'budapest', 'orban', 'romania', 'romanian', 'bulgaria', 'greece', 'greek', 'athens',
  'serbia', 'croatia', 'slovakia', 'slovenia', 'moldova', 'georgian', 'tbilisi', 'armenia', 'azerbaijan', 'estonia', 'latvia', 'lithuania', 'belarus',
  'ukraine', 'ukrainian', 'kyiv', 'russia', 'russian', 'moscow', 'kremlin', 'european union', 'eu', 'european parliament', 'european commission',
  // Middle East and Africa
  'türkiye', 'turkish', 'ankara', 'istanbul', 'erdogan', 'israel', 'israeli', 'jerusalem', 'tel aviv', 'gaza', 'west bank', 'netanyahu',
  'iran', 'iranian', 'tehran', 'iraq', 'iraqi', 'baghdad', 'syria', 'syrian', 'damascus', 'lebanon', 'lebanese', 'beirut', 'saudi', 'riyadh',
  'uae', 'emirates', 'emirati', 'dubai', 'abu dhabi', 'sharjah', 'qatar', 'doha', 'kuwait', 'bahrain', 'oman', 'yemen', 'egypt', 'egyptian', 'cairo',
  'libya', 'tunisia', 'algeria', 'morocco', 'sudan', 'ethiopia', 'kenya', 'nairobi', 'nigeria', 'nigerian', 'ghana', 'south africa', 'congo', 'somalia',
  // Asia and Oceania
  'china', 'chinese', 'beijing', 'shanghai', 'hong kong', 'taiwan', 'taiwanese', 'taipei', 'japan', 'japanese', 'tokyo', 'korea', 'korean', 'seoul', 'pyongyang',
  'india', 'new delhi', 'delhi', 'mumbai', 'modi', 'pakistan', 'pakistani', 'islamabad', 'afghanistan', 'afghan', 'kabul', 'bangladesh', 'sri lanka', 'nepal',
  'indonesia', 'jakarta', 'malaysia', 'singapore', 'thailand', 'bangkok', 'vietnam', 'hanoi', 'philippines', 'manila', 'myanmar',
  'australia', 'australian', 'canberra', 'sydney', 'melbourne', 'new zealand',
  // Latin America
  'brazil', 'brazilian', 'brasilia', 'lula', 'argentina', 'argentine', 'buenos aires', 'milei', 'chile', 'chilean', 'peru', 'colombia', 'colombian', 'bogota',
  'venezuela', 'venezuelan', 'caracas', 'maduro', 'cuba', 'cuban', 'havana', 'ecuador', 'bolivia', 'haiti', 'panama', 'guatemala', 'honduras', 'el salvador', 'nicaragua',
  'mexico city', 'mexican government', 'sheinbaum',
];

/** The US, for stories in other segments (Canadian politics) that are really about Washington. */
export const USA = ['u.s.', 'united states', 'american', 'americans', 'trump', 'white house', 'congress', 'washington', 'republicans', 'democrats', 'gop', 'pentagon'];
