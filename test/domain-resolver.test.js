const test = require('node:test');
const assert = require('node:assert');
const { extractDomainFromResolver, looksLikeForum } = require('../src/utils/domain-resolver');

test('extractDomainFromResolver: URL-encoded site: query', () => {
  assert.equal(
    extractDomainFromResolver('https://www.google.com/search?q=site%3A1tamilmv.pizza'),
    '1tamilmv.pizza'
  );
});

test('extractDomainFromResolver: plain site: query', () => {
  assert.equal(
    extractDomainFromResolver('https://www.google.com/search?q=site:1tamilmv.boo'),
    '1tamilmv.boo'
  );
});

test('extractDomainFromResolver: strips www. from site: domain', () => {
  assert.equal(
    extractDomainFromResolver('https://www.google.com/search?q=site%3Awww.1tamilmv.pizza'),
    '1tamilmv.pizza'
  );
});

test('extractDomainFromResolver: direct forum URL returns its host', () => {
  assert.equal(
    extractDomainFromResolver('https://www.1tamilmv.xyz/index.php?/forums'),
    '1tamilmv.xyz'
  );
});

test('extractDomainFromResolver: bare search-engine host yields null', () => {
  assert.equal(extractDomainFromResolver('https://www.google.com/'), null);
  assert.equal(extractDomainFromResolver('https://duckduckgo.com/'), null);
});

test('extractDomainFromResolver: junk input yields null', () => {
  assert.equal(extractDomainFromResolver(''), null);
  assert.equal(extractDomainFromResolver(null), null);
  assert.equal(extractDomainFromResolver('not a url'), null);
});

test('looksLikeForum: true for forum markers, false for parked page', () => {
  assert.equal(looksLikeForum('<a href="/topic/123">x</a>'), true);
  assert.equal(looksLikeForum('welcome to 1TamilMV'), true);
  assert.equal(looksLikeForum('<title>Google Search</title>'), false);
  assert.equal(looksLikeForum(''), false);
  assert.equal(looksLikeForum(null), false);
});
