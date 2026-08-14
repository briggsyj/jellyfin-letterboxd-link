/**
 * Letterboxd Link - injected into jellyfin-web's index.html by the
 * LetterboxdLink plugin (via the File Transformation plugin).
 *
 * Adds a button to a movie's details page, a button to movie rows in list
 * views (between the favourite and "more" buttons), and an entry to the
 * "more" menu on movie cards, all linking to the film's Letterboxd page,
 * resolved from its TMDb id via the (undocumented but long-standing)
 * https://letterboxd.com/tmdb/{tmdbId}/ redirect.
 *
 * Pure helper functions live at the top and are exported for unit tests
 * (see test/letterboxd-link.test.js) via the CommonJS guard below them.
 * Everything after that guard touches the DOM/ApiClient and only runs in
 * a browser.
 */
(function () {
    'use strict';

    var BUTTON_CLASS = 'btnLetterboxdLink';
    var MENU_ITEM_CLASS = 'btnLetterboxdLinkMenuItem';
    var LIST_ITEM_BUTTON_CLASS = 'btnLetterboxdLinkListItem';
    var DETAILS_ROUTE_PREFIX = '#/details';
    // Records which item a details page's buttons container has already been
    // resolved for. Tracked on the container rather than inferred from the
    // button's presence, because "this movie has no TMDb id" is a settled
    // answer that renders no button and must not be re-fetched forever.
    var HANDLED_ATTRIBUTE = 'data-letterboxd-handled';
    var RETRY_INTERVAL_MS = 500;
    var MAX_RETRY_ATTEMPTS = 20;
    var PENDING_ITEM_TIMEOUT_MS = 3000;

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

    // Every Letterboxd control uses the same star glyph, so this builds the
    // material-icons span (with its aria-hidden flag) and leaves each caller
    // to supply only the context-specific class names.
    function createIcon(className) {
        var icon = document.createElement('span');
        icon.className = className;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
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
        content.appendChild(createIcon('material-icons detailButton-icon star_rate'));

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

    function clearHandledMarkers() {
        var handled = document.querySelectorAll('[' + HANDLED_ATTRIBUTE + ']');
        for (var i = 0; i < handled.length; i++) {
            handled[i].removeAttribute(HANDLED_ATTRIBUTE);
        }
    }

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
        if (!container || container.getAttribute(HANDLED_ATTRIBUTE) === itemId) {
            return;
        }

        // Claim the container before the lookup starts. The details page makes
        // many batches of DOM changes while it renders, and the observer below
        // calls this on each of them, so without the claim every batch would
        // start another lookup for the same item.
        container.setAttribute(HANDLED_ATTRIBUTE, itemId);
        lastRequestedItemId = itemId;

        apiClient.getItem(apiClient.getCurrentUserId(), itemId).then(function (item) {
            if (itemId !== lastRequestedItemId) {
                return;
            }

            var currentContainer = findDetailButtonsContainer();
            if (currentContainer) {
                currentContainer.setAttribute(HANDLED_ATTRIBUTE, itemId);
                renderButton(currentContainer, item);
            }
        }).catch(function () {
            // Item fetch failed - leave no button rather than a broken one,
            // but release the claim so a later attempt can retry.
            container.removeAttribute(HANDLED_ATTRIBUTE);
        });
    }

    // ---- Card meatball-menu entry --------------------------------------
    // Movie cards in list views show a hover overlay with a "more" (meatball)
    // button that opens jellyfin-web's item context menu - an action-sheet
    // popup listing Play, Play All From Here, Copy Stream URL, etc. The
    // Letterboxd link is added as an entry in that menu (after "Copy Stream
    // URL"), rather than as its own hover-overlay button, since another
    // hover button pushes the overlay's width out.
    //
    // Cards only expose the Jellyfin item id in the DOM, and the action sheet
    // itself carries no reference back to the card that opened it, so the
    // flow is: capture the interaction that opens the sheet (before
    // jellyfin-web's own handler consumes it) and remember the item id, then
    // inject a menu entry for it once the action sheet's markup appears. The
    // remembered id is cleared after use, or after a short timeout, so a stray
    // interaction can't leak into an unrelated action sheet opened later.
    //
    // The sheet can be opened two ways: a left-click on the "more" (meatball)
    // button, or a right-click (contextmenu) anywhere on the card - both open
    // the same item action sheet, so both are captured below.

    var pendingCardItemId = null;
    var pendingCardItemTimer = null;

    function rememberPendingCardItem(itemId) {
        pendingCardItemId = itemId;
        if (pendingCardItemTimer) {
            window.clearTimeout(pendingCardItemTimer);
        }
        pendingCardItemTimer = window.setTimeout(function () {
            pendingCardItemId = null;
            pendingCardItemTimer = null;
        }, PENDING_ITEM_TIMEOUT_MS);
    }

    function consumePendingCardItem() {
        var itemId = pendingCardItemId;
        pendingCardItemId = null;
        if (pendingCardItemTimer) {
            window.clearTimeout(pendingCardItemTimer);
            pendingCardItemTimer = null;
        }
        return itemId;
    }

    // Finds the movie card the given element belongs to and, if it's a movie,
    // remembers its item id so the pending action sheet gets a menu entry.
    function rememberCardFromElement(element) {
        var card = element && element.closest ? element.closest('.card') : null;
        if (!card || card.getAttribute('data-type') !== 'Movie') {
            return;
        }

        var itemId = card.getAttribute('data-id');
        if (itemId) {
            rememberPendingCardItem(itemId);
        }
    }

    // Capture phase: runs before jellyfin-web's own delegated click handler
    // (which stops propagation once it recognises the "more" button), for
    // both the legacy and React card implementations - both mark their
    // "more" button with data-action="menu".
    document.addEventListener('click', function (event) {
        var moreButton = event.target && event.target.closest ? event.target.closest('[data-action="menu"]') : null;
        if (moreButton) {
            rememberCardFromElement(moreButton);
        }
    }, true);

    // Right-clicking (or long-pressing) a card opens the same item action
    // sheet without ever touching the "more" button, so capture contextmenu
    // events on the card itself too.
    document.addEventListener('contextmenu', function (event) {
        rememberCardFromElement(event.target);
    }, true);

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

    function createMenuItem(itemId) {
        var button = document.createElement('button');
        button.setAttribute('is', 'emby-button');
        button.type = 'button';
        // Mirrors the markup jellyfin-web's actionsheet.js renders for its own
        // entries, so this one is styled and laid out identically.
        button.className = 'listItem listItem-button actionSheetMenuItem ' + MENU_ITEM_CLASS;
        button.setAttribute('data-id', 'letterboxd-link');

        button.appendChild(createIcon('actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons star_rate'));

        var body = document.createElement('div');
        body.className = 'listItemBody actionsheetListItemBody';
        var text = document.createElement('div');
        text.className = 'listItemBodyText actionSheetItemText';
        text.textContent = 'View on Letterboxd';
        body.appendChild(text);
        button.appendChild(body);

        // Runs before the action sheet's own (bubbling) click handler, which
        // closes the menu once it sees the click land on an
        // .actionSheetMenuItem - so there's no need to close it here too.
        button.addEventListener('click', function () {
            openLetterboxdForItem(itemId);
        });

        return button;
    }

    function injectMenuItem(actionSheetEl) {
        var scroller = actionSheetEl.querySelector('.actionSheetScroller');
        if (!scroller || scroller.querySelector('.' + MENU_ITEM_CLASS)) {
            return;
        }

        var itemId = consumePendingCardItem();
        if (!itemId) {
            return;
        }

        var menuItem = createMenuItem(itemId);
        var afterItem = scroller.querySelector('[data-id="copy-stream"]') || scroller.querySelector('[data-id="download"]');
        if (afterItem) {
            afterItem.insertAdjacentElement('afterend', menuItem);
        } else {
            scroller.appendChild(menuItem);
        }
    }

    // Runs `inject` over a freshly added subtree: on the node itself if it
    // matches `selector`, and on any matching descendants - the subtree can be
    // the element of interest (e.g. a single action sheet) or a container of
    // several (e.g. a whole list view rendering at once). Only newly added
    // subtrees are inspected, rather than rescanning the page on every mutation.
    function injectIntoMatches(node, selector, inject) {
        if (node.matches && node.matches(selector)) {
            inject(node);
        }

        if (node.querySelectorAll) {
            var matches = node.querySelectorAll(selector);
            for (var i = 0; i < matches.length; i++) {
                inject(matches[i]);
            }
        }
    }

    // ---- List view row button -------------------------------------------
    // Movie rows in list views (jellyfin-web's listview.js) render their own
    // favourite and "more" buttons directly in the markup, each carrying the
    // item id already - unlike cards, there's no click-to-open-menu step to
    // hook, so the Letterboxd button is inserted straight into that row
    // between them, resolving the link lazily on click like the card menu
    // entry does.

    function createListItemButton(itemId) {
        var button = document.createElement('button');
        button.setAttribute('is', 'paper-icon-button-light');
        button.type = 'button';
        button.className = 'listItemButton ' + LIST_ITEM_BUTTON_CLASS;
        button.title = 'View on Letterboxd';

        button.appendChild(createIcon('material-icons star_rate'));

        // Stops the click from bubbling up to jellyfin-web's row-level
        // itemAction handler, which would otherwise treat it as a click on
        // the row itself and navigate to the item's details page.
        button.addEventListener('click', function (event) {
            event.stopPropagation();
            openLetterboxdForItem(itemId);
        });

        return button;
    }

    function injectListItemButton(listItem) {
        var container = listItem.querySelector('.listViewUserDataButtons');
        if (!container || container.querySelector('.' + LIST_ITEM_BUTTON_CLASS)) {
            return;
        }

        var itemId = listItem.getAttribute('data-id');
        if (!itemId) {
            return;
        }

        var button = createListItemButton(itemId);
        var moreButton = container.querySelector('[data-action="menu"]');
        if (moreButton) {
            container.insertBefore(button, moreButton);
        } else {
            container.appendChild(button);
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

    window.addEventListener('hashchange', function () {
        // A route change can leave the same container element in place while
        // jellyfin-web re-renders its buttons, wiping ours. Drop the markers
        // so the current route is resolved from scratch.
        clearHandledMarkers();
        scheduleRetries();
    });

    var observer = new MutationObserver(function (mutations) {
        // Details page: fallback for when its content is replaced without a
        // hashchange event (e.g. navigating between items in the same list).
        // tryInject() is a no-op unless the container is present and not yet
        // resolved for the current item, so calling it per batch is cheap.
        tryInject();

        // Action sheets and list view rows: inject into any that have just
        // appeared.
        for (var i = 0; i < mutations.length; i++) {
            var addedNodes = mutations[i].addedNodes;
            for (var j = 0; j < addedNodes.length; j++) {
                var node = addedNodes[j];
                if (node.nodeType === 1) { // Element nodes only
                    injectIntoMatches(node, '.actionSheet', injectMenuItem);
                    injectIntoMatches(node, '.listItem[data-type="Movie"]', injectListItemButton);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    scheduleRetries();
}());
