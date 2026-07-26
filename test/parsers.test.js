const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectLanguagesFromTitle,
  detectSeriesFromTitle,
  extractEpisodeFromText,
  extractEpisodeRangeFromDescription,
  extractQualityFromMagnetText
} = require('../src/scraper/parsers');

test('detectLanguagesFromTitle: parenthesized full names', () => {
  const langs = detectLanguagesFromTitle('Some Movie (2025) (Tamil + Telugu + Hindi)');
  assert.ok(langs.includes('tamil'));
  assert.ok(langs.includes('telugu'));
  assert.ok(langs.includes('hindi'));
});

test('detectLanguagesFromTitle: bracketed abbreviations', () => {
  const langs = detectLanguagesFromTitle('Big Film (2025) [TAM + TEL + HIN + ENG]');
  assert.deepEqual(new Set(langs), new Set(['tamil', 'telugu', 'hindi', 'english']));
});

test('detectLanguagesFromTitle: no language returns empty', () => {
  assert.deepEqual(detectLanguagesFromTitle('Just A Title 2025'), []);
});

test('detectSeriesFromTitle: season + episode range', () => {
  const info = detectSeriesFromTitle('Run Away (2025) S01 EP(01-08)');
  assert.equal(info.isSeries, true);
  assert.equal(info.season, 1);
  assert.deepEqual(info.episodes, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('detectSeriesFromTitle: plain movie is not a series', () => {
  const info = detectSeriesFromTitle('Leo (2023) (Tamil)');
  assert.equal(info.isSeries, false);
  assert.equal(info.season, null);
  assert.deepEqual(info.episodes, []);
});

test('extractEpisodeFromText: common patterns', () => {
  assert.equal(extractEpisodeFromText('Show.S01E05.1080p'), 5);
  assert.equal(extractEpisodeFromText('Show EP03 WEB-DL'), 3);
  assert.equal(extractEpisodeFromText('Show Episode 12'), 12);
  assert.equal(extractEpisodeFromText('Show EP(07)'), 7);
  assert.equal(extractEpisodeFromText('Season pack no episode'), null);
});

test('extractEpisodeRangeFromDescription: season + range', () => {
  const info = extractEpisodeRangeFromDescription('New drops S01 EP (65-68) available now');
  assert.equal(info.season, 1);
  assert.deepEqual(info.episodes, [65, 66, 67, 68]);
});

test('extractQualityFromMagnetText: quality detection', () => {
  assert.equal(extractQualityFromMagnetText('Movie 2160p UHD'), '4K');
  assert.equal(extractQualityFromMagnetText('Movie 1080p WEB-DL'), '1080p');
  assert.equal(extractQualityFromMagnetText('Movie 720p'), '720p');
  assert.equal(extractQualityFromMagnetText('Movie 480p'), '480p');
});
