# DoorDash Enhanced (userscript)

Restaurant-first DoorDash in the browser. Hides grocery/retail/convenience clutter and sponsored content, and adds a **Restaurants** link to the side nav.

## Install
1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey) in Brave/Chrome.
2. Tampermonkey dashboard → **+** (new script) → paste the contents of `doordash-enhanced.user.js` → save.
3. Open doordash.com. A red ⚙ button (bottom-right) opens settings; it's also in the Tampermonkey menu.

## Features (all toggleable)
- Add a **Restaurants** link under Home (URL editable in settings).
- Hide side-nav rows (Grocery, Retail, Convenience, Pets, Flowers, Beauty, Health by default).
- Hide promo banners (billboards, auto-scrolling ads).
- Hide sponsored carousels and sponsored store cards (never inside *Your past orders* / *Saved stores*).
- Hide grocery/convenience/retail sections and non-restaurant stores in mixed lists.
- Hide any section by title — hover a section header and click **Hide**, or edit the list in settings.
- Stop the photo slideshow that plays when you hover a store card (off by default).
- **Debug mode**: dims and labels hidden items instead of removing them, useful when something disappears that shouldn't.

## How it decides what's a restaurant
- Store links carry a cursor with `store_primary_vertical_ids`; vertical `1` = restaurants. Stores under `/convenience/store/...` (or any `/<type>/store/...`) are non-restaurants.
- Sections linking to `/vertical_homepage` with a non-restaurant vertical (2 = convenience, 3 = grocery, …) are hidden.
- Anything it can't classify is left visible.

## Hooks used (update these if DoorDash changes its markup)
| What | Selector |
|---|---|
| Side nav rows | `[data-testid="side-nav"] li#Grocery` etc. |
| Feed sections | `#store_feed [data-testid="overlay-content"] > div > *` |
| Section titles | `[data-anchor-id="CarouselControllerTitle(Content)"]` |
| Promo banners | `[data-testid="subsystem.cx.merchandising_billboard"]`, `[data-mosaic-view-lego-type="cx.spotlight_auto_scroll"]` |
| Store cards | `[data-testid="card.store"]`, `a[data-anchor-id="StoreCard"]` |
