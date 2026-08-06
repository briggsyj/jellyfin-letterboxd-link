'use strict';

// DOM/behaviour tests for the browser-only half of letterboxd-link.js -
// specifically the movie-card hover-overlay button, which is resolved lazily
// on click. The script is evaluated inside a jsdom window with a mocked
// ApiClient and window.open, then driven through the real MutationObserver.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', 'Jellyfin.Plugin.LetterboxdLink', 'Web', 'letterboxd-link.js'),
    'utf8'
);

const CARD_BUTTON_SELECTOR = '.btnLetterboxdLinkCard';

// Builds a movie card whose hover overlay contains a favourite and a "more"
// button, mirroring jellyfin-web's legacy cardBuilder overlay markup.
function cardHtml(dataType, dataId) {
    return '<div class="card" data-id="' + dataId + '" data-type="' + dataType + '">'
        + '<div class="cardBox"><div class="cardOverlayContainer itemAction">'
        + '<div class="cardOverlayButton-br flex">'
        + '<button class="favBtn"><span class="material-icons favorite"></span></button>'
        + '<button class="moreBtn"><span class="material-icons more_vert"></span></button>'
        + '</div></div></div></div>';
}

function setup(options) {
    options = options || {};
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'https://jellyfin.test/web/',
        runScripts: 'outside-only'
    });
    const window = dom.window;

    const openedTabs = [];
    window.open = function () {
        const tab = { location: null, closed: false, opener: {}, close() { this.closed = true; } };
        openedTabs.push(tab);
        return tab;
    };

    window.ApiClient = {
        getCurrentUserId() { return 'user-1'; },
        getItem(userId, itemId) {
            return Promise.resolve(options.itemsById ? options.itemsById[itemId] : undefined);
        }
    };

    // Run the plugin's injected script in the jsdom window context.
    window.eval(SCRIPT_SOURCE);

    return { dom, window, document: window.document, openedTabs };
}

async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 1000);
    for (;;) {
        const result = predicate();
        if (result) {
            return result;
        }
        if (Date.now() > deadline) {
            throw new Error('waitFor timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('injects the button into a Movie card overlay, before the "more" button', async () => {
    const { window, document } = setup();
    document.body.innerHTML = cardHtml('Movie', 'abc');

    const button = await waitFor(() => document.querySelector(CARD_BUTTON_SELECTOR));

    const moreButton = document.querySelector('.moreBtn');
    const position = button.compareDocumentPosition(moreButton);
    assert.ok(position & window.Node.DOCUMENT_POSITION_FOLLOWING, 'button should come before the more button');
    assert.match(button.querySelector('span').className, /star_rate/);
});

test('does not inject the button into non-Movie cards', async () => {
    const { document } = setup();
    document.body.innerHTML = cardHtml('Series', 'series-1');

    // Give the observer a chance to run, then assert nothing was added.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(document.querySelector(CARD_BUTTON_SELECTOR), null);
});

test('does not inject a second button if the overlay is processed again', async () => {
    const { document } = setup();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardHtml('Movie', 'abc');
    document.body.appendChild(wrapper);

    await waitFor(() => document.querySelector(CARD_BUTTON_SELECTOR));

    // Re-attaching the same subtree runs the overlay through the observer
    // again; the idempotency guard should keep it at one button.
    document.body.removeChild(wrapper);
    document.body.appendChild(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(document.querySelectorAll(CARD_BUTTON_SELECTOR).length, 1);
});

test('clicking points the opened tab at the film\'s Letterboxd page', async () => {
    const { document, window, openedTabs } = setup({
        itemsById: { abc: { Type: 'Movie', ProviderIds: { Tmdb: '550' } } }
    });
    document.body.innerHTML = cardHtml('Movie', 'abc');

    const button = await waitFor(() => document.querySelector(CARD_BUTTON_SELECTOR));
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    // The tab is opened synchronously; its destination is set once the async
    // item lookup resolves.
    assert.equal(openedTabs.length, 1);
    await waitFor(() => openedTabs[0].location);
    assert.equal(openedTabs[0].location, 'https://letterboxd.com/tmdb/550/');
});

test('clicking a movie with no TMDb id closes the opened tab', async () => {
    const { document, window, openedTabs } = setup({
        itemsById: { abc: { Type: 'Movie', ProviderIds: {} } }
    });
    document.body.innerHTML = cardHtml('Movie', 'abc');

    const button = await waitFor(() => document.querySelector(CARD_BUTTON_SELECTOR));
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    assert.equal(openedTabs.length, 1);
    await waitFor(() => openedTabs[0].closed);
    assert.equal(openedTabs[0].location, null);
});
