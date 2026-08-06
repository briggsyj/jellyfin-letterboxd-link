'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    getTmdbId,
    buildLetterboxdUrl,
    isSupportedItemType,
    getItemIdFromHash,
    isDetailsRoute
} = require(path.join('..', 'Jellyfin.Plugin.LetterboxdLink', 'Web', 'letterboxd-link.js'));

test('getTmdbId returns the id for a movie with a TMDb provider id', () => {
    const item = { ProviderIds: { Tmdb: '550' } };
    assert.equal(getTmdbId(item), '550');
});

test('getTmdbId returns null when ProviderIds is missing', () => {
    assert.equal(getTmdbId({}), null);
    assert.equal(getTmdbId(null), null);
    assert.equal(getTmdbId(undefined), null);
});

test('getTmdbId returns null when there is no Tmdb id', () => {
    const item = { ProviderIds: { Imdb: 'tt0137523' } };
    assert.equal(getTmdbId(item), null);
});

test('getTmdbId accepts the alternate TMDb provider-id key casings', () => {
    assert.equal(getTmdbId({ ProviderIds: { TMDb: '550' } }), '550');
    assert.equal(getTmdbId({ ProviderIds: { tmdb: '550' } }), '550');
});

test('getTmdbId rejects non-numeric ids', () => {
    const item = { ProviderIds: { Tmdb: 'not-a-number' } };
    assert.equal(getTmdbId(item), null);
});

test('getTmdbId trims whitespace around a valid id', () => {
    const item = { ProviderIds: { Tmdb: ' 550 ' } };
    assert.equal(getTmdbId(item), '550');
});

test('buildLetterboxdUrl builds the tmdb redirect url', () => {
    assert.equal(buildLetterboxdUrl('550'), 'https://letterboxd.com/tmdb/550/');
});

test('isSupportedItemType is true only for movies', () => {
    assert.equal(isSupportedItemType({ Type: 'Movie' }), true);
    assert.equal(isSupportedItemType({ Type: 'Series' }), false);
    assert.equal(isSupportedItemType({ Type: 'Episode' }), false);
    assert.equal(isSupportedItemType(null), false);
    assert.equal(isSupportedItemType(undefined), false);
});

test('isDetailsRoute recognizes the details route', () => {
    assert.equal(isDetailsRoute('#/details?id=abc123'), true);
    assert.equal(isDetailsRoute('#/details'), true);
    assert.equal(isDetailsRoute('#/home'), false);
    assert.equal(isDetailsRoute(''), false);
    assert.equal(isDetailsRoute(undefined), false);
});

test('getItemIdFromHash extracts the id query parameter', () => {
    assert.equal(getItemIdFromHash('#/details?id=abc123'), 'abc123');
    assert.equal(getItemIdFromHash('#/details?foo=bar&id=xyz789&baz=qux'), 'xyz789');
});

test('getItemIdFromHash returns null when not on the details route', () => {
    assert.equal(getItemIdFromHash('#/home?id=abc123'), null);
});

test('getItemIdFromHash returns null when there is no query string', () => {
    assert.equal(getItemIdFromHash('#/details'), null);
});

test('getItemIdFromHash returns null when the id parameter is absent', () => {
    assert.equal(getItemIdFromHash('#/details?foo=bar'), null);
});
