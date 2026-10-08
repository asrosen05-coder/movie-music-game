const MIN_MOVIES = 4;
const PREVIEW_URL = /^https:\/\/[a-z0-9.-]+\.apple\.com\//;

export async function loadData() {
  // no-cache = always revalidate, so a deploy never pairs new code with stale data (or vice versa).
  const [songsRes, moviesRes] = await Promise.all([
    fetch('data/songs.json', { cache: 'no-cache' }),
    fetch('data/movies.json', { cache: 'no-cache' }),
  ]);
  if (!songsRes.ok || !moviesRes.ok) {
    throw new Error('Failed to fetch game data files.');
  }

  const songs = await songsRes.json();
  const movies = await moviesRes.json();
  return validate(songs, movies);
}

/** Movie problems are fatal (they break every question); a bad song is skipped with a warning. */
export function validate(songs, movies) {
  if (!Array.isArray(songs) || !Array.isArray(movies)) {
    throw new Error('Game data is malformed (expected arrays).');
  }
  if (movies.length < MIN_MOVIES) {
    throw new Error(`Need at least ${MIN_MOVIES} movies, found ${movies.length}.`);
  }

  const movieIds = new Set();
  for (const movie of movies) {
    if (movieIds.has(movie.id)) throw new Error(`Duplicate movie id "${movie.id}".`);
    movieIds.add(movie.id);
  }

  const songIds = new Set();
  const playable = songs.filter((song) => {
    const problem =
      songIds.has(song.id) ? 'duplicate id'
      : !movieIds.has(song.movieId) ? `unknown movieId "${song.movieId}"`
      : !PREVIEW_URL.test(song.previewUrl || '') ? 'no valid Apple preview URL'
      : !Number.isInteger(song.appleTrackId) ? 'no appleTrackId'
      : song.alsoIn !== undefined && (!Array.isArray(song.alsoIn) || song.alsoIn.includes(song.movieId))
        ? 'alsoIn must be a list of its other movies'
      : song.alsoIn !== undefined && song.alsoIn.some((id) => !movieIds.has(id))
        ? 'alsoIn names an unknown movie'
      : null;
    songIds.add(song.id);
    if (problem) console.warn(`Skipping song "${song.id}": ${problem}.`);
    return !problem;
  });

  if (playable.length < 1) {
    throw new Error('No playable songs found in dataset.');
  }
  return { songs: playable, movies };
}

/** "Dirty Dancing (1987)": the label every option and reveal uses. */
export function formatMovieLabel(movie) {
  return `${movie.title} (${movie.year})`;
}
