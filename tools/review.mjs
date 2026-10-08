// Results of the hand review, keyed like the catalog: "title | artist | movieId".

// Songs neither the film's nor the song's Wikipedia article confirmed automatically, with the
// sources that confirm them (checked by hand).
export const manualSources = {
  "Free Fallin' | Tom Petty | jerry-maguire-1996": 'ScreenCrush, "Best Tom Petty Music in Movies"; Slate, "Tom Petty made the best driving music"',
  'Bang Bang (My Baby Shot Me Down) | Nancy Sinatra | kill-bill-vol-1-2003': 'Wikipedia, "Kill Bill Vol. 1 (soundtrack)"',
  "Woo Hoo | The 5.6.7.8's | kill-bill-vol-1-2003": 'Wikipedia, "Kill Bill Vol. 1 (soundtrack)"',
  'Shout | The Isley Brothers | wedding-crashers-2005': 'Songfacts, "Shout" by The Isley Brothers; Indiana Daily Student review (2005)',
};

// Apple matches rejected on review (wrong recording that the filters let through).
export const rejectedMatches = {
};
