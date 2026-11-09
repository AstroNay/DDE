// ==UserScript==
// @name         DoorDash Enhanced
// @namespace    https://github.com/AstroNay/DDE
// @version      0.4.0
// @description  Restaurant-first DoorDash: hide grocery/retail/convenience clutter and sponsored content, add a Restaurants shortcut.
// @match        https://www.doordash.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  // Side-nav rows, keyed by the <li id="..."> DoorDash uses.
  const NAV_ROWS = ['Grocery', 'Retail', 'Convenience', 'Gifts', 'Pets', 'Flowers', 'Beauty', 'Gift Cards', 'Health'];

  // DoorDash "vertical" ids seen in store/section cursors. 1 = restaurants.
  const RESTAURANT_VERTICAL = 1;
  const NON_RESTAURANT_VERTICALS = new Set([2, 3, 4, 70, 136, 146, 241]); // convenience, grocery, gifts, pets, beauty, flowers, health

  const DEFAULTS = {
    addRestaurantsLink: true,
    restaurantsUrl: makeVerticalUrl(RESTAURANT_VERTICAL, 'Restaurants'),
    hiddenNav: ['Grocery', 'Retail', 'Convenience', 'Pets', 'Flowers', 'Beauty', 'Health'],
    hidePromoBanners: true,       // big billboard / auto-scrolling banner ads
    hideSponsoredSections: true,  // carousels whose header says "Sponsored"
    hideSponsoredCards: true,     // individual store cards labelled "Sponsored"
    hideNonRestaurantSections: true, // grocery/convenience/retail carousels
    hideNonRestaurantCards: true,    // individual non-restaurant stores in mixed rows
    hiddenTitles: ['Convenience & drugstores', 'Quick essentials nearby', 'Retail stores delivered'],
    showSectionHideButtons: true, // small "Hide" button on each section header
    disableCardSlideshow: false,  // stop store cards cycling photos on hover
    debugMode: false,             // dim + outline instead of hiding
  };

  function loadSettings() {
    const saved = safeGet('settings', {});
    return Object.assign({}, DEFAULTS, saved);
  }
  function saveSettings() {
    safeSet('settings', settings);
  }
  function safeGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const v = localStorage.getItem('dde:' + key);
      return v ? JSON.parse(v) : fallback;
    } catch (_) { return fallback; }
  }
  function safeSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') return GM_setValue(key, value);
      localStorage.setItem('dde:' + key, JSON.stringify(value));
    } catch (_) { /* ignore */ }
  }

  let settings = loadSettings();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeVerticalUrl(id, title) {
    const cursor = {
      offset: 0,
      vertical_ids: [id],
      cross_vertical_page_type: 'VERTICAL_PAGE',
      page_stack_trace: [],
      layout_override: 'UNSPECIFIED',
      is_pagination_fallback: null,
      source_page_type: null,
      vertical_title: title,
      vertical_names: { [id]: title },
    };
    return 'https://www.doordash.com/vertical/feed?cursor=' +
      encodeURIComponent(btoa(JSON.stringify(cursor))) + '&page_type=vertical_page';
  }

  function decodeCursor(href) {
    try {
      const url = new URL(href, location.origin);
      const c = url.searchParams.get('cursor');
      if (!c) return null;
      return JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) { return null; }
  }

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  /** 'restaurant' | 'other' | 'unknown' for a store link. */
  const storeCache = new Map();
  function classifyStoreHref(href) {
    if (!href) return 'unknown';
    let url;
    try { url = new URL(href, location.origin); } catch (_) { return 'unknown'; }
    const key = url.pathname;
    if (storeCache.has(key)) return storeCache.get(key);
    let result = 'unknown';
    // /convenience/store/123, /retail/store/123 etc. -> not a restaurant
    if (/^\/[^/]+\/store\/\d+/.test(url.pathname) && !/^\/reviews\//.test(url.pathname)) {
      result = 'other';
    } else if (/^\/store\//.test(url.pathname)) {
      const cur = decodeCursor(href);
      const ids = cur && cur.store_primary_vertical_ids;
      if (Array.isArray(ids)) {
        if (ids.includes(RESTAURANT_VERTICAL)) result = 'restaurant';
        else if (ids.some((i) => NON_RESTAURANT_VERTICALS.has(i))) result = 'other';
      }
    }
    if (result !== 'unknown') storeCache.set(key, result);
    return result;
  }

  function hasExactText(root, text) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.trim() === text) return true;
    }
    return false;
  }

  // Marking: we never remove DoorDash's nodes, we only tag them so React stays happy.
  const ATTR = 'data-dde-hidden';
  function mark(el, reason) {
    if (!el || el.hasAttribute(ATTR)) return;
    el.setAttribute(ATTR, reason);
  }
  function clearMarks() {
    document.querySelectorAll('[' + ATTR + ']').forEach((el) => el.removeAttribute(ATTR));
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const SLIDESHOW = '[data-anchor-id="WindowShoppingCarousel"]';

  const style = document.createElement('style');
  style.id = 'dde-style';
  function renderStyle() {
    const hideRule = settings.debugMode
      ? `[${ATTR}] { opacity: .25 !important; outline: 2px dashed #e5484d !important; position: relative; }
         [${ATTR}]::before { content: 'DDE: ' attr(${ATTR}); position: absolute; z-index: 5; top: 0; left: 0;
           background: #e5484d; color: #fff; font: 600 11px/1.6 system-ui, sans-serif; padding: 0 6px; border-radius: 0 0 4px 0; }`
      : `[${ATTR}] { display: none !important; }`;
    const slideshowRule = settings.disableCardSlideshow
      ? `${SLIDESHOW} ul[aria-label="pagination-dots"], ${SLIDESHOW} span[selectedindex],
         ${SLIDESHOW} button[aria-label="Next button of carousel"],
         ${SLIDESHOW} button[aria-label="Previous button of carousel"] { display: none !important; }`
      : '';
    style.textContent = hideRule + slideshowRule + `
      .dde-restaurants-row a { text-decoration: none; }
      .dde-hide-btn { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid #d0d0d0;
        background: #fff; color: #555; font: 500 12px/1.5 system-ui, sans-serif; cursor: pointer; opacity: 0;
        transition: opacity .15s; vertical-align: middle; }
      [data-dde-section]:hover .dde-hide-btn { opacity: 1; }
      .dde-hide-btn:hover { background: #fbeaea; border-color: #e5484d; color: #c62a2f; }
      #dde-gear { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: flex; align-items: center;
        gap: 6px; height: 36px; padding: 0 14px 0 10px; border-radius: 999px; border: 2px solid #fff;
        background: #191919; color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer;
        box-shadow: 0 2px 12px rgba(0,0,0,.3); }
      #dde-gear:hover { background: #333; }
      #dde-gear .dde-gear-icon { font-size: 17px; line-height: 1; }
      #dde-panel { position: fixed; left: 16px; bottom: 62px; z-index: 2147483000; width: 340px; max-height: 75vh;
        overflow: auto; background: #fff; color: #191919; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
        font: 14px/1.4 system-ui, sans-serif; padding: 16px; }
      #dde-panel h2 { font-size: 16px; margin: 0 0 8px; }
      #dde-panel h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #767676; margin: 14px 0 6px; }
      #dde-panel label { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0; cursor: pointer; }
      #dde-panel input[type=checkbox] { margin-top: 3px; accent-color: #eb1700; }
      #dde-panel .dde-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
      #dde-panel textarea, #dde-panel input[type=text] { width: 100%; box-sizing: border-box; font: 12px/1.4 ui-monospace, monospace;
        border: 1px solid #ccc; border-radius: 6px; padding: 6px; }
      #dde-panel textarea { min-height: 80px; resize: vertical; }
      #dde-panel .dde-hint { color: #767676; font-size: 12px; margin: 2px 0 0; }
      #dde-panel .dde-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
      #dde-panel button { border-radius: 999px; padding: 6px 14px; border: 1px solid #ccc; background: #fff; cursor: pointer; font: inherit; }
      #dde-panel button.dde-primary { background: #eb1700; border-color: #eb1700; color: #fff; }
    `;
  }

  // ---------------------------------------------------------------------------
  // Side navigation
  // ---------------------------------------------------------------------------

  function applyNav() {
    const nav = document.querySelector('[data-testid="side-nav"] nav ul');
    if (!nav) return;

    for (const id of settings.hiddenNav) {
      const li = nav.querySelector(`li[id="${CSS.escape(id)}"]`);
      if (li) mark(li, 'nav');
    }

    let row = nav.querySelector('.dde-restaurants-row');
    if (!settings.addRestaurantsLink) {
      if (row) row.remove();
      return;
    }
    const home = nav.querySelector('li#Home');
    if (!home) return;
    if (row && row.previousElementSibling === home) {
      row.querySelector('a').href = settings.restaurantsUrl;
      return;
    }
    if (row) row.remove();

    // Clone the Home row so it inherits DoorDash's own styling.
    row = home.cloneNode(true);
    row.id = 'dde-Restaurants';
    row.removeAttribute('data-test-id');
    row.classList.add('dde-restaurants-row');
    const a = row.querySelector('a');
    a.href = settings.restaurantsUrl;
    a.removeAttribute('aria-current');
    // Full page load: avoids DoorDash's client router ignoring our cloned link.
    a.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      location.href = settings.restaurantsUrl;
    }, true);
    const svg = row.querySelector('svg');
    if (svg) {
      svg.outerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-2v7h-1V2H9v7H8V2H7Zm10 0c-2 0-3 2.5-3 6v5h2v9h2V2h-1Z"
        fill="var(--usage-color-text-default, #191919)"/></svg>`;
    }
    // Replace the visible "Home" label text.
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.trim() === 'Home') n.nodeValue = 'Restaurants';
    }
    home.after(row);
  }

  // ---------------------------------------------------------------------------
  // Home feed sections
  // ---------------------------------------------------------------------------

  function getSections() {
    const container = document.querySelector('#store_feed [data-testid="overlay-content"] > div');
    if (!container) return [];
    return Array.from(container.children).filter((el) => el.tagName !== 'STYLE');
  }

  function sectionTitle(section) {
    const t = section.querySelector('[data-anchor-id="CarouselControllerTitleContent"], [data-anchor-id="CarouselControllerTitle"]');
    if (t) {
      const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue.trim();
        if (v && v !== 'Sponsored') return v;
      }
    }
    // e.g. "More stores" heading without anchor ids
    const first = section.querySelector('h2, h3, span');
    return first ? first.textContent.trim() : '';
  }

  function isPromoBanner(section) {
    return !!section.querySelector(
      '[data-testid="subsystem.cx.merchandising_billboard"], [data-mosaic-view-lego-type="cx.spotlight_auto_scroll"]'
    ) || section.matches('[data-mosaic-view-lego-type="cx.spotlight_auto_scroll"]');
  }

  function isSponsoredSection(section) {
    const header = section.querySelector('[data-anchor-id="CarouselControllerTitle"]');
    return !!header && hasExactText(header, 'Sponsored');
  }

  function isNonRestaurantSection(section) {
    // "Grocery stock up", "Lunch in minutes" etc. link to a vertical homepage.
    const vLink = section.querySelector('a[href*="/vertical_homepage"]');
    if (vLink) {
      const cur = decodeCursor(vLink.href);
      const ids = cur && cur.vertical_ids;
      if (Array.isArray(ids) && ids.length && !ids.includes(RESTAURANT_VERTICAL)) return true;
    }
    // Store carousels: hide when every identifiable store is a non-restaurant.
    const seen = new Set();
    let other = 0, rest = 0;
    section.querySelectorAll('a[href*="/store/"]').forEach((a) => {
      const path = a.pathname;
      if (seen.has(path)) return;
      seen.add(path);
      const c = classifyStoreHref(a.href);
      if (c === 'other') other++;
      else if (c === 'restaurant') rest++;
    });
    return other > 0 && rest === 0;
  }

  function addHideButton(section, title) {
    if (!settings.showSectionHideButtons || !title) return;
    if (section.querySelector('.dde-hide-btn')) return;
    const anchor = section.querySelector('[data-anchor-id="CarouselControllerTitleContent"]') ||
      section.querySelector('[data-anchor-id="CarouselControllerTitle"]');
    if (!anchor) return;
    section.setAttribute('data-dde-section', '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dde-hide-btn';
    btn.textContent = 'Hide';
    btn.title = `Hide "${title}" (undo in DoorDash Enhanced settings)`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!settings.hiddenTitles.some((t) => norm(t) === norm(title))) {
        settings.hiddenTitles = settings.hiddenTitles.concat(title);
        saveSettings();
      }
      mark(section, 'hidden title');
    }, true);
    (anchor.tagName === 'A' ? anchor.parentElement : anchor).appendChild(btn);
  }

  function applySections() {
    const hidden = new Set(settings.hiddenTitles.map(norm));
    for (const section of getSections()) {
      const title = sectionTitle(section);
      if (title && hidden.has(norm(title))) { mark(section, 'hidden title'); continue; }
      if (settings.hidePromoBanners && isPromoBanner(section)) { mark(section, 'promo banner'); continue; }
      if (settings.hideSponsoredSections && isSponsoredSection(section)) { mark(section, 'sponsored section'); continue; }
      if (settings.hideNonRestaurantSections && isNonRestaurantSection(section)) { mark(section, 'non-restaurant section'); continue; }
      addHideButton(section, title);
    }
  }

  // ---------------------------------------------------------------------------
  // Individual store cards (home feed, "More stores", search, category pages)
  // ---------------------------------------------------------------------------

  /**
   * Climb from a store link to the element that occupies one slot in its list.
   * Hiding the slot (not just the inner card) lets the row reflow without a gap.
   */
  function cardRoot(link) {
    const testCard = link.closest('[data-testid="card.store"]');
    let el = link;
    while (el.parentElement && el.parentElement !== document.body) {
      const parent = el.parentElement;
      // Never treat a whole feed section (or the page) as one card.
      if (parent.id === 'main-content' || parent.matches('#store_feed [data-testid="overlay-content"] > div')) {
        return testCard;
      }
      // Parent holds links to more than one store -> el is a single card.
      const paths = new Set();
      parent.querySelectorAll('a[href*="/store/"]').forEach((a) => paths.add(a.pathname));
      if (paths.size > 1) return el;
      el = parent;
    }
    return testCard;
  }

  /** "Your past orders" / "Saved stores": the user's own picks, never hide sponsored cards there. */
  function isPersonalSection(section) {
    const a = section.querySelector('a[data-anchor-id="CarouselControllerTitle"], [data-anchor-id="CarouselSeeAllButton"]');
    if (!a || !a.href) return false;
    if (a.href.includes('/saved-stores')) return true;
    const cur = decodeCursor(a.href);
    return !!(cur && typeof cur.request_child_id === 'string' && /:favorites$/.test(cur.request_child_id));
  }

  /** Only links that are store cards (not e.g. /reviews/store/123 on a store page). */
  function isStoreCardLink(a) {
    const anchor = a.getAttribute('data-anchor-id') || '';
    if (anchor !== 'StoreCard' && !/^\d+$/.test(anchor) && !a.closest('[data-testid="card.store"]')) return false;
    return /^\/(?:[a-z_-]+\/)?store\/\d+/.test(a.pathname) && !/^\/reviews\//.test(a.pathname);
  }

  // A store card is never this tall; anything bigger means we climbed too far.
  const MAX_CARD_HEIGHT = 700;

  function applyCards() {
    if (!settings.hideSponsoredCards && !settings.hideNonRestaurantCards) return;
    // A store's own page (menu, reviews) has no store lists worth filtering.
    if (/^\/(?:[a-z_-]+\/)?store\//.test(location.pathname)) return;
    const personal = getSections().filter(isPersonalSection);
    const done = new Set();
    const lists = new Set();
    document.querySelectorAll('#main-content a[href*="/store/"]').forEach((a) => {
      if (!isStoreCardLink(a)) return;
      const card = cardRoot(a);
      if (!card || done.has(card)) return;
      if (card.getBoundingClientRect().height > MAX_CARD_HEIGHT) return;
      done.add(card);
      if (card.parentElement) lists.add(card.parentElement);
      if (card.closest('[' + ATTR + ']')) return;
      rememberPositions(card.parentElement);
      if (settings.hideNonRestaurantCards && classifyStoreHref(a.href) === 'other') {
        mark(card, 'non-restaurant store');
      } else if (settings.hideSponsoredCards && hasExactText(card, 'Sponsored') &&
                 !personal.some((s) => s.contains(card))) {
        mark(card, 'sponsored store');
      }
    });
    lists.forEach(compactList);
  }

  // ---------------------------------------------------------------------------
  // Gap filling
  // ---------------------------------------------------------------------------
  // Normal flex/grid rows reflow by themselves once a slot is display:none.
  // Virtualized carousels position each slot absolutely, so hiding one leaves a
  // hole. For those we remember every slot's position and slide the remaining
  // visible slots into the earliest free positions with the CSS `translate`
  // property (independent of any `transform` DoorDash sets itself).

  const slotPos = new WeakMap(); // element -> {l, t}
  const SHIFTED = 'data-dde-shifted';

  const isAbsolute = (el) => {
    const p = getComputedStyle(el).position;
    return p === 'absolute' || p === 'fixed';
  };

  function rememberPositions(list) {
    if (!list) return;
    for (const child of list.children) {
      if (child.hasAttribute(ATTR) || child.tagName === 'STYLE') continue;
      // offsetLeft/Top ignore `translate`, so this is the slot DoorDash assigned.
      slotPos.set(child, { l: child.offsetLeft, t: child.offsetTop });
    }
  }

  function compactList(list) {
    if (settings.debugMode) return; // debug shows hidden items in place
    const kids = Array.from(list.children).filter((c) => c.tagName !== 'STYLE');
    const visible = kids.filter((c) => !c.hasAttribute(ATTR));
    if (!visible.length || !visible.some(isAbsolute)) return; // flow layout already reflowed
    rememberPositions(list);
    const slots = kids.map((c) => slotPos.get(c)).filter(Boolean)
      .sort((a, b) => a.t - b.t || a.l - b.l);
    const ordered = visible.filter((c) => slotPos.has(c))
      .sort((a, b) => slotPos.get(a).t - slotPos.get(b).t || slotPos.get(a).l - slotPos.get(b).l);
    ordered.forEach((el, i) => {
      const from = slotPos.get(el);
      const to = slots[i];
      const dx = to.l - from.l, dy = to.t - from.t;
      const value = dx || dy ? `${dx}px ${dy}px` : '';
      if (el.style.translate !== value) el.style.translate = value;
      if (value) el.setAttribute(SHIFTED, ''); else el.removeAttribute(SHIFTED);
    });
  }

  function clearShifts() {
    document.querySelectorAll('[' + SHIFTED + ']').forEach((el) => {
      el.style.translate = '';
      el.removeAttribute(SHIFTED);
    });
  }

  // ---------------------------------------------------------------------------
  // Settings panel
  // ---------------------------------------------------------------------------

  function openPanel() {
    let panel = document.getElementById('dde-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'dde-panel';
    const cb = (key, label, hint) => `
      <label><input type="checkbox" data-key="${key}" ${settings[key] ? 'checked' : ''}>
      <span>${label}${hint ? `<div class="dde-hint">${hint}</div>` : ''}</span></label>`;
    panel.innerHTML = `
      <h2>DoorDash Enhanced</h2>
      <h3>Navigation</h3>
      ${cb('addRestaurantsLink', 'Add “Restaurants” link under Home')}
      <input type="text" data-key="restaurantsUrl" value="">
      <div class="dde-hint">Restaurants link target. Paste a different URL here if you prefer another page.</div>
      <h3>Hide side-nav items</h3>
      <div class="dde-grid">
        ${NAV_ROWS.map((r) => `<label><input type="checkbox" data-nav="${r}" ${settings.hiddenNav.includes(r) ? 'checked' : ''}><span>${r}</span></label>`).join('')}
      </div>
      <h3>Home &amp; lists</h3>
      ${cb('hidePromoBanners', 'Hide promo banners', 'Large billboard and auto-scrolling ads')}
      ${cb('hideSponsoredSections', 'Hide sponsored carousels')}
      ${cb('hideSponsoredCards', 'Hide sponsored store cards')}
      ${cb('hideNonRestaurantSections', 'Hide grocery / convenience / retail sections')}
      ${cb('hideNonRestaurantCards', 'Hide non-restaurant stores in mixed lists')}
      ${cb('showSectionHideButtons', 'Show a “Hide” button on section headers')}
      ${cb('disableCardSlideshow', 'Stop photo slideshow on hover', 'Store cards keep their first photo')}
      <h3>Hidden section titles</h3>
      <textarea data-key="hiddenTitles"></textarea>
      <div class="dde-hint">One per line, exact title (case-insensitive).</div>
      <h3>Troubleshooting</h3>
      ${cb('debugMode', 'Debug mode', 'Dim and label hidden items instead of removing them')}
      <div class="dde-actions">
        <button type="button" data-act="reset">Reset</button>
        <button type="button" data-act="close">Close</button>
        <button type="button" class="dde-primary" data-act="save">Save</button>
      </div>`;
    panel.querySelector('[data-key="restaurantsUrl"]').value = settings.restaurantsUrl;
    panel.querySelector('[data-key="hiddenTitles"]').value = settings.hiddenTitles.join('\n');

    panel.addEventListener('click', (e) => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'close') { panel.remove(); return; }
      if (act === 'reset') {
        if (!confirm('Reset DoorDash Enhanced settings to defaults?')) return;
        settings = Object.assign({}, DEFAULTS);
      } else if (act === 'save') {
        panel.querySelectorAll('input[type=checkbox][data-key]').forEach((i) => { settings[i.dataset.key] = i.checked; });
        settings.hiddenNav = Array.from(panel.querySelectorAll('input[data-nav]')).filter((i) => i.checked).map((i) => i.dataset.nav);
        settings.restaurantsUrl = panel.querySelector('[data-key="restaurantsUrl"]').value.trim() || DEFAULTS.restaurantsUrl;
        settings.hiddenTitles = panel.querySelector('[data-key="hiddenTitles"]').value
          .split('\n').map((s) => s.trim()).filter(Boolean);
      }
      saveSettings();
      panel.remove();
      reapply();
    });
    document.body.appendChild(panel);
  }

  function addGear() {
    if (document.getElementById('dde-gear')) return;
    const gear = document.createElement('button');
    gear.id = 'dde-gear';
    gear.type = 'button';
    gear.title = 'DoorDash Enhanced settings';
    gear.innerHTML = '<span class="dde-gear-icon">⚙</span><span>Enhanced</span>';
    gear.addEventListener('click', openPanel);
    document.body.appendChild(gear);
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  function apply() {
    try {
      applyNav();
      applySections();
      applyCards();
      addGear();
    } catch (err) {
      console.warn('[DoorDash Enhanced]', err);
    }
  }

  function reapply() {
    renderStyle();
    clearMarks();
    clearShifts();
    document.querySelectorAll('.dde-hide-btn').forEach((b) => b.remove());
    apply();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; apply(); }, 150);
  }

  // Card photo slideshow: DoorDash starts it from hover events handled by React at
  // its root. Swallowing those events in the capture phase on window (which runs
  // before React's listeners) stops the slideshow; clicks are untouched.
  const HOVER_EVENTS = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousemove', 'pointermove'];
  // React derives onMouseEnter/Leave from over/out pairs, using relatedTarget for
  // the element on the other side. Block any hover event where either side is in
  // a slideshow region, so neither "enter" nor "leave" ever reaches React.
  const SLIDESHOW_REGION = `${SLIDESHOW}, :has(> ${SLIDESHOW})`;
  const inSlideshow = (n) => !!(n && n.closest && n.closest(SLIDESHOW_REGION));
  function blockSlideshowHover(e) {
    if (!settings.disableCardSlideshow) return;
    if (inSlideshow(e.target) || inSlideshow(e.relatedTarget)) e.stopImmediatePropagation();
  }

  // Installed at document-start, before DoorDash's own listeners exist.
  HOVER_EVENTS.forEach((type) => window.addEventListener(type, blockSlideshowHover, true));

  function start() {
    renderStyle();
    (document.head || document.documentElement).appendChild(style);
    apply();
    new MutationObserver((muts) => {
      // Ignore mutations caused only by our own UI.
      for (const m of muts) {
        const t = m.target;
        if (t.id === 'dde-panel' || (t.closest && t.closest('#dde-panel'))) continue;
        schedule();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true });
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Settings', openPanel);
    }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
