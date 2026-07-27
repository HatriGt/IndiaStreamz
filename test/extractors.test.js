const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateMovieId,
  generateSeriesId,
  generateEpisodeStreamId,
  extractInfoHash,
  extractStreamDetailsFromMagnet,
  sizeStringToBytes,
  extractFilenameFromMagnet,
  structureStreamsForStremio,
  cleanTitleForDisplay
} = require('../src/scraper/extractors');

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const MAGNET_4K = `magnet:?xt=urn:btih:${HASH}&dn=${encodeURIComponent('Movie (2025) 2160p UHD HEVC DD+5.1 - 17.8GB')}`;

test('generateMovieId: deterministic and language-prefixed', () => {
  const a = generateMovieId('Leo', ['tamil']);
  const b = generateMovieId('Leo', ['tamil']);
  assert.equal(a, b);
  assert.ok(a.startsWith('tamil-leo-'));
});

test('generateMovieId: multi-language uses multi prefix', () => {
  const id = generateMovieId('Salaar', ['tamil', 'telugu']);
  assert.ok(id.startsWith('multi-salaar-'));
});

test('generateSeriesId includes season, episode stream id format', () => {
  const sid = generateSeriesId('Farzi', 1, ['hindi']);
  assert.ok(sid.startsWith('hindi-farzi-s1-'));
  assert.equal(generateEpisodeStreamId(sid, 1, 5), `${sid}:1:5`);
});

test('extractInfoHash pulls 40-char btih hash', () => {
  assert.equal(extractInfoHash(MAGNET_4K), HASH);
});

test('extractStreamDetailsFromMagnet parses quality/codec/audio/size', () => {
  const d = extractStreamDetailsFromMagnet(MAGNET_4K);
  assert.equal(d.quality, '2160p');
  assert.equal(d.codec, 'HEVC');
  assert.equal(d.size, '17.8GB');
});

test('sizeStringToBytes converts units', () => {
  assert.equal(sizeStringToBytes('1GB'), 1024 ** 3);
  assert.equal(sizeStringToBytes('700MB'), 700 * 1024 ** 2);
  assert.equal(sizeStringToBytes('not a size'), null);
});

test('extractFilenameFromMagnet decodes dn', () => {
  assert.equal(extractFilenameFromMagnet(MAGNET_4K), 'Movie (2025) 2160p UHD HEVC DD+5.1 - 17.8GB');
  assert.equal(extractFilenameFromMagnet('magnet:?xt=urn:btih:abc'), null);
});

test('structureStreamsForStremio builds stream objects with known-good shape', () => {
  const streams = structureStreamsForStremio([MAGNET_4K], ['2160p UHD'], ['4K']);
  assert.equal(streams.length, 1);
  const s = streams[0];
  assert.equal(s.infoHash, HASH);
  assert.ok(typeof s.externalUrl === 'string' && s.externalUrl.startsWith('magnet:'));
  // Final shape: videoSize + filename hints present; NO stream.title.
  // (title combined with description breaks stremio-core web stream parsing.)
  assert.equal(s.title, undefined);
  assert.ok(s.behaviorHints.videoSize > 0);
  assert.ok(typeof s.behaviorHints.filename === 'string');
  assert.ok(typeof s.behaviorHints.bingeGroup === 'string');
});

test('cleanTitleForDisplay strips year, language, technical noise', () => {
  const cleaned = cleanTitleForDisplay('Leo (2023) (Tamil) - WEB-DL - [1080p & 720p]');
  assert.ok(!/2023/.test(cleaned));
  assert.ok(!/tamil/i.test(cleaned));
  assert.ok(/Leo/i.test(cleaned));
});
