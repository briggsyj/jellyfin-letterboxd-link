'use strict';

// DOM/behaviour tests for the browser-only half of letterboxd-link.js -
// specifically the movie-card "more" menu entry, which is resolved lazily
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

const MENU_ITEM_SELECTOR = '.btnLetterboxdLinkMenuItem';

// Builds a movie card whose hover overlay contains a "more" button, mirroring
// jellyfin-web's cardBuilder overlay markup (data-action="menu" is present on
// both the legacy and React "more" button implementations).
function cardHtml(dataType, dataId) {
    return '<div class="card" data-id="' + dataId + '" data-type="' + dataType + '">'
        + '<div class="cardBox"><div class="cardOverlayContainer itemAction">'
        + '<div class="cardOverlayButton-br flex">'
        + '<button class="moreBtn" data-action="menu"><span class="material-icons more_vert"></span></button>'
        + '</div></div></div></div>';
}

// Builds an action sheet mirroring jellyfin-web's actionsheet.js output,
// with a "Copy Stream URL" entry so insertion-after-it can be verified.
function actionSheetHtml() {
    return '<div class="actionSheet actionsheet-not-fullscreen">'
        + '<div class="actionSheetContent">'
        + '<div class="actionSheetScroller">'
        + '<button class="listItem listItem-button actionSheetMenuItem" data-id="resume">Play</button>'
        + '<button class="listItem listItem-button actionSheetMenuItem" data-id="copy-stream">Copy Stream URL</button>'
        + '<button class="listItem listItem-button actionSheetMenuItem" data-id="delete">Delete</button>'
        + '</div></div></div>';
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

// Clicking the card's "more" button, then appending an action sheet, mirrors
// what jellyfin-web does: the button click kicks off an async chain that
// eventually renders the action sheet into the DOM.
function clickMoreButton(document) {
    const moreButton = document.querySelector('.moreBtn');
    moreButton.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('injects a menu entry after "Copy Stream URL" once the action sheet for a Movie card appears', async () => {
    const { window, document } = setup();
    document.body.innerHTML = cardHtml('Movie', 'abc');

    clickMoreButton(document);
    document.body.insertAdjacentHTML('beforeend', actionSheetHtml());

    const menuItem = await waitFor(() => document.querySelector(MENU_ITEM_SELECTOR));

    const copyStreamButton = document.querySelector('[data-id="copy-stream"]');
    assert.equal(menuItem.previousElementSibling, copyStreamButton);
    assert.match(menuItem.querySelector('span').className, /star_rate/);
    assert.equal(menuItem.querySelector('.listItemBodyText').textContent, 'View on Letterboxd');
    void window;
});

test('does not inject a menu entry for a non-Movie card', async () => {
    const { document } = setup();
    document.body.innerHTML = cardHtml('Series', 'series-1');

    clickMoreButton(document);
    document.body.insertAdjacentHTML('beforeend', actionSheetHtml());

    // Give the observer a chance to run, then assert nothing was added.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(document.querySelector(MENU_ITEM_SELECTOR), null);
});

test('does not inject a menu entry into an action sheet opened without a preceding "more" click', async () => {
    const { document } = setup();
    document.body.innerHTML = cardHtml('Movie', 'abc');

    // No clickMoreButton() call - simulates an unrelated action sheet
    // (e.g. a sort-order picker) opening elsewhere in the app.
    document.body.insertAdjacentHTML('beforeend', actionSheetHtml());

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(document.querySelector(MENU_ITEM_SELECTOR), null);
});

test('does not inject a second menu entry if the action sheet is processed again', async () => {
    const { document } = setup();
    document.body.innerHTML = cardHtml('Movie', 'abc');

    clickMoreButton(document);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = actionSheetHtml();
    document.body.appendChild(wrapper);

    await waitFor(() => document.querySelector(MENU_ITEM_SELECTOR));

    // Re-attaching the same subtree runs it through the observer again; the
    // idempotency guard should keep it at one menu entry.
    document.body.removeChild(wrapper);
    document.body.appendChild(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(document.querySelectorAll(MENU_ITEM_SELECTOR).length, 1);
});

test('clicking the menu entry points the opened tab at the film\'s Letterboxd page', async () => {
    const { document, window, openedTabs } = setup({
        itemsById: { abc: { Type: 'Movie', ProviderIds: { Tmdb: '550' } } }
    });
    document.body.innerHTML = cardHtml('Movie', 'abc');

    clickMoreButton(document);
    document.body.insertAdjacentHTML('beforeend', actionSheetHtml());

    const menuItem = await waitFor(() => document.querySelector(MENU_ITEM_SELECTOR));
    menuItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    // The tab is opened synchronously; its destination is set once the async
    // item lookup resolves.
    assert.equal(openedTabs.length, 1);
    await waitFor(() => openedTabs[0].location);
    assert.equal(openedTabs[0].location, 'https://letterboxd.com/tmdb/550/');
});

test('clicking the menu entry for a movie with no TMDb id closes the opened tab', async () => {
    const { document, window, openedTabs } = setup({
        itemsById: { abc: { Type: 'Movie', ProviderIds: {} } }
    });
    document.body.innerHTML = cardHtml('Movie', 'abc');

    clickMoreButton(document);
    document.body.insertAdjacentHTML('beforeend', actionSheetHtml());

    const menuItem = await waitFor(() => document.querySelector(MENU_ITEM_SELECTOR));
    menuItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    assert.equal(openedTabs.length, 1);
    await waitFor(() => openedTabs[0].closed);
    assert.equal(openedTabs[0].location, null);
});
