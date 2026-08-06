/**
 * Letterboxd Link - injected into jellyfin-web's index.html by the
 * LetterboxdLink plugin (via the File Transformation plugin).
 *
 * Adds a button to a movie's details page and to the hover overlay on movie
 * cards, linking to the film's Letterboxd page, resolved from its TMDb id via
 * the (undocumented but long-standing) https://letterboxd.com/tmdb/{tmdbId}/
 * redirect.
 *
 * Pure helper functions live at the top and are exported for unit tests
 * (see test/letterboxd-link.test.js) via the CommonJS guard below them.
 * Everything after that guard touches the DOM/ApiClient and only runs in
 * a browser.
 */
(function () {
    'use strict';

    var BUTTON_CLASS = 'btnLetterboxdLink';
    var CARD_BUTTON_CLASS = 'btnLetterboxdLinkCard';
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

    // ---- Card / poster overlay button --------------------------------
    // Movie cards in list views show a hover overlay (play / watched /
    // favourite / more). Unlike the details page, a card only exposes the
    // Jellyfin item id in the DOM, not the TMDb id - so the Letterboxd link is
    // resolved lazily when the button is actually clicked, rather than fetching
    // every visible movie up front just to render the overlay.

    function openLetterboxdForItem(itemId) {
        var apiClient = window.ApiClient;
        if (!apiClient) {
            return;
        }

        // Open the tab synchronously inside the click handler. If window.open
        // were called later, after the async item lookup below, the browser
        // would treat it as a non-user-initiated popup and block it.
        var newTab = window.open('about:blank', '_blank');
        if (newTab) {
            newTab.opener = null;
        }

        apiClient.getItem(apiClient.getCurrentUserId(), itemId).then(function (item) {
            if (!newTab) {
                return;
            }

            var tmdbId = getTmdbId(item);
            if (tmdbId) {
                newTab.location = buildLetterboxdUrl(tmdbId);
            } else {
                // Movie has no TMDb id, so there's nothing to link to.
                newTab.close();
            }
        }).catch(function () {
            if (newTab) {
                newTab.close();
            }
        });
    }

    function createCardButton(itemId) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'cardOverlayButton cardOverlayButton-hover paper-icon-button-light ' + CARD_BUTTON_CLASS;
        button.title = 'View on Letterboxd';

        var icon = document.createElement('span');
        icon.className = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover star_rate';
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);

        button.addEventListener('click', function (event) {
            // The overlay container is itself an "itemAction" that navigates to
            // the Jellyfin item, so stop the click from reaching it.
            event.preventDefault();
            event.stopPropagation();
            openLetterboxdForItem(itemId);
        });

        return button;
    }

    function injectCardButton(container) {
        if (container.querySelector('.' + CARD_BUTTON_CLASS)) {
            return;
        }

        var card = container.closest('.card');
        if (!card || card.getAttribute('data-type') !== 'Movie') {
            return;
        }

        var itemId = card.getAttribute('data-id');
        if (!itemId) {
            return;
        }

        var button = createCardButton(itemId);

        // Place it just before the "more" (meatball) button, i.e. after the
        // favourite button.
        var moreIcon = container.querySelector('.material-icons.more_vert');
        var moreButton = moreIcon ? moreIcon.closest('button') : null;
        if (moreButton) {
            container.insertBefore(button, moreButton);
        } else {
            container.appendChild(button);
        }
    }

    // Card hover overlays are created on demand as the user hovers cards, so
    // only inspect freshly added subtrees rather than rescanning the page.
    function processCardOverlays(node) {
        if (node.matches && node.matches('.cardOverlayButton-br')) {
            injectCardButton(node);
        }

        if (node.querySelectorAll) {
            var containers = node.querySelectorAll('.cardOverlayButton-br');
            for (var i = 0; i < containers.length; i++) {
                injectCardButton(containers[i]);
            }
        }
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

    var observer = new MutationObserver(function (mutations) {
        // Details page: fallback for when its content is replaced without a
        // hashchange event (e.g. navigating between items in the same list).
        var hash = window.location.hash || '';
        if (isDetailsRoute(hash) && findDetailButtonsContainer() && !document.querySelector('.' + BUTTON_CLASS)) {
            tryInject();
        }

        // Card overlays: inject into any hover menus that have just appeared.
        for (var i = 0; i < mutations.length; i++) {
            var addedNodes = mutations[i].addedNodes;
            for (var j = 0; j < addedNodes.length; j++) {
                var node = addedNodes[j];
                if (node.nodeType === 1) { // Element nodes only
                    processCardOverlays(node);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    scheduleRetries();
}());
