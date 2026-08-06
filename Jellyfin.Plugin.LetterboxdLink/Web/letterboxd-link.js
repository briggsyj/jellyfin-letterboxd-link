/**
 * Letterboxd Link - injected into jellyfin-web's index.html by the
 * LetterboxdLink plugin (via the File Transformation plugin).
 *
 * Adds a button to the movie details page that links to the film's
 * Letterboxd page, resolved from its TMDb id via the (undocumented but
 * long-standing) https://letterboxd.com/tmdb/{tmdbId}/ redirect.
 *
 * Pure helper functions live at the top and are exported for unit tests
 * (see test/letterboxd-link.test.js) via the CommonJS guard below them.
 * Everything after that guard touches the DOM/ApiClient and only runs in
 * a browser.
 */
(function () {
    'use strict';

    var BUTTON_CLASS = 'btnLetterboxdLink';
    var DETAILS_ROUTE_PREFIX = '#/details';
    var RETRY_INTERVAL_MS = 500;
    var MAX_RETRY_ATTEMPTS = 20;

    /**
     * Extracts a usable TMDb id from a Jellyfin BaseItemDto's ProviderIds.
     * Returns null if there isn't one, or it isn't a plain integer id.
     */
    function getTmdbId(item) {
        if (!item || !item.ProviderIds) {
            return null;
        }

        var ids = item.ProviderIds;
        var tmdbId = ids.Tmdb || ids.TMDb || ids.tmdb;
        if (!tmdbId) {
            return null;
        }

        var trimmed = String(tmdbId).trim();
        return /^\d+$/.test(trimmed) ? trimmed : null;
    }

    /**
     * Builds the Letterboxd deep-link URL for a TMDb id.
     */
    function buildLetterboxdUrl(tmdbId) {
        return 'https://letterboxd.com/tmdb/' + tmdbId + '/';
    }

    /**
     * Letterboxd is a film-only site: only render the button for movies.
     */
    function isSupportedItemType(item) {
        return !!item && item.Type === 'Movie';
    }

    /**
     * Extracts the item id from a details page hash, e.g.
     * "#/details?id=abc123" -> "abc123". Returns null if not a details
     * route or there's no id present.
     */
    function getItemIdFromHash(hash) {
        if (!isDetailsRoute(hash)) {
            return null;
        }

        var queryIndex = hash.indexOf('?');
        if (queryIndex === -1) {
            return null;
        }

        var params = new URLSearchParams(hash.substring(queryIndex + 1));
        return params.get('id');
    }

    /**
     * True if the given location hash is the item details route
     * ("#/details..."). Used to decide whether the button belongs on the
     * current page at all.
     */
    function isDetailsRoute(hash) {
        return typeof hash === 'string' && hash.indexOf(DETAILS_ROUTE_PREFIX) === 0;
    }

    // eslint-disable-next-line no-undef
    if (typeof module !== 'undefined' && module.exports) {
        // eslint-disable-next-line no-undef
        module.exports = {
            getTmdbId: getTmdbId,
            buildLetterboxdUrl: buildLetterboxdUrl,
            isSupportedItemType: isSupportedItemType,
            getItemIdFromHash: getItemIdFromHash,
            isDetailsRoute: isDetailsRoute
        };
    }

    // ---- Browser-only code below this point --------------------------
    // (there is no `document` under node:test, so stop here in that case)
    if (typeof document === 'undefined') {
        return;
    }

    function findDetailButtonsContainer() {
        var pages = document.querySelectorAll('.itemDetailPage:not(.hide)');
        for (var i = 0; i < pages.length; i++) {
            var container = pages[i].querySelector('.mainDetailButtons');
            if (container) {
                return container;
            }
        }

        return null;
    }

    function createButton(tmdbId) {
        var anchor = document.createElement('a');
        anchor.setAttribute('is', 'emby-linkbutton');
        anchor.className = 'button-flat ' + BUTTON_CLASS + ' detailButton emby-button';
        anchor.href = buildLetterboxdUrl(tmdbId);
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.title = 'View on Letterboxd';

        var content = document.createElement('div');
        content.className = 'detailButton-content';

        var icon = document.createElement('span');
        icon.className = 'material-icons detailButton-icon star_rate';
        icon.setAttribute('aria-hidden', 'true');

        content.appendChild(icon);
        anchor.appendChild(content);
        return anchor;
    }

    function removeExistingButton(container) {
        var existing = container.querySelector('.' + BUTTON_CLASS);
        if (existing) {
            existing.remove();
        }
    }

    function renderButton(container, item) {
        removeExistingButton(container);

        var tmdbId = getTmdbId(item);
        if (!isSupportedItemType(item) || !tmdbId) {
            // No TMDb id (or not a movie): show nothing rather than a dead link.
            return;
        }

        var button = createButton(tmdbId);
        var moreCommandsButton = container.querySelector('.btnMoreCommands');
        if (moreCommandsButton) {
            container.insertBefore(button, moreCommandsButton);
        } else {
            container.appendChild(button);
        }
    }

    // Guards against a slow item fetch resolving after the user has already
    // navigated to a different item (or away from the details page).
    var lastRequestedItemId = null;

    function tryInject() {
        var hash = window.location.hash || '';
        if (!isDetailsRoute(hash)) {
            return;
        }

        var itemId = getItemIdFromHash(hash);
        var apiClient = window.ApiClient;
        if (!itemId || !apiClient) {
            return;
        }

        var container = findDetailButtonsContainer();
        if (!container) {
            return;
        }

        lastRequestedItemId = itemId;

        apiClient.getItem(apiClient.getCurrentUserId(), itemId).then(function (item) {
            if (itemId !== lastRequestedItemId) {
                return;
            }

            var currentContainer = findDetailButtonsContainer();
            if (currentContainer) {
                renderButton(currentContainer, item);
            }
        }).catch(function () {
            // Item fetch failed - leave no button rather than a broken one.
        });
    }

    // The details page (and its buttons) can render asynchronously after
    // route/DOM changes, so a single attempt right after navigation is not
    // reliable. Poll briefly until the buttons container shows up.
    function scheduleRetries() {
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;

            var hash = window.location.hash || '';
            if (!isDetailsRoute(hash)) {
                window.clearInterval(timer);
                return;
            }

            if (findDetailButtonsContainer()) {
                window.clearInterval(timer);
                tryInject();
                return;
            }

            if (attempts >= MAX_RETRY_ATTEMPTS) {
                window.clearInterval(timer);
            }
        }, RETRY_INTERVAL_MS);
    }

    window.addEventListener('hashchange', scheduleRetries);

    // Fallback for cases where the details page content is replaced without
    // a hashchange event (e.g. navigating between items in the same list).
    var observer = new MutationObserver(function () {
        var hash = window.location.hash || '';
        if (isDetailsRoute(hash) && findDetailButtonsContainer() && !document.querySelector('.' + BUTTON_CLASS)) {
            tryInject();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    scheduleRetries();
}());
