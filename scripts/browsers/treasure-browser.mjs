/**
 * Draw Steel â€“ Hideout
 * Treasure Browser: browse compendium/world treasure items.
 * Selecting an item offers two options: Add as Crafting Project / Add to Party Stash.
 */

import { MODULE_ID, DEFAULT_TREASURE_PACK_IDS, TREASURE_INDEX_FIELDS, SETTINGS } from "../config.mjs";
import { hasGMPermission } from "../socket.mjs";
import { addStashItem } from "../hideout/stash-manager.mjs";
import { addArchiveEntry } from "../hideout/archives-manager.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * @typedef {Object} TreasureEntry
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} description
 * @property {string} category
 * @property {number} echelon
 * @property {string} source
 * @property {string} sourceLabel
 * @property {boolean} hasCraftingData Whether the item has project data.
 */

let _treasureCachedIndex = null;
let _treasureCachedSourceOptions = null;

/**
 * Resolve a treasure item's keywords into a sorted array of localized label strings.
 * Mirrors TreasureModel.formattedKeywords for use on raw index entries.
 * @param {Set|Array|undefined} keywordSet
 * @param {string} category
 * @param {string} kind
 * @returns {string[]}
 */
function _getTreasureKeywordLabels(keywordSet, category, kind) {
  const labels = Array.from(keywordSet ?? []).map(kw =>
    ds.CONFIG.equipment.keywords[kw]?.label
    ?? ds.CONFIG.equipment.categories[category]?.keywords?.find(k => k.value === kw)?.label
    ?? ds.CONFIG.equipment[kind]?.[kw]?.label
    ?? kw
  );
  labels.sort((a, b) => a.localeCompare(b));
  return labels;
}

export async function loadTreasureIndex() {
  const entries = [];

  const packs = game.packs.filter(pack => {
    if (pack.documentName !== "Item") return false;
    const meta = pack.metadata;
    if (meta.packageType === "system" && meta.packageName !== "draw-steel") return false;
    return true;
  });

  const results = await Promise.all(packs.map(async (pack) => {
    try {
      const index = await pack.getIndex({ fields: TREASURE_INDEX_FIELDS });
      const packId = pack.metadata.id;
      const sourceLabel = pack.title;
      const packEntries = [];

      for (const entry of index) {
        if (entry.type !== "treasure") continue;
        packEntries.push({
          uuid: `Compendium.${pack.metadata.id}.Item.${entry._id}`,
          name: entry.name,
          img: entry.img || "icons/svg/item-bag.svg",
          description: entry.system?.description?.value ?? "",
          category: entry.system?.category ?? "",
          echelon: entry.system?.echelon ?? 0,
          keywords: _getTreasureKeywordLabels(entry.system?.keywords, entry.system?.category, entry.system?.kind),
          source: packId,
          sourceLabel,
          hasCraftingData: !!entry.system?.project?.goal,
          projectData: entry.system?.project ?? null,
        });
      }
      return packEntries;
    } catch (err) {
      console.warn(`draw-steel-hideout | Failed to index pack ${pack.metadata.id}:`, err);
      return [];
    }
  }));

  for (const r of results) entries.push(...r);

  // World treasures
  for (const item of game.items) {
    if (item.type !== "treasure") continue;
    entries.push({
      uuid: item.uuid,
      name: item.name,
      img: item.img || "icons/svg/item-bag.svg",
      description: item.system.description?.value ?? "",
      category: item.system.category ?? "",
      echelon: item.system.echelon ?? 0,
      keywords: _getTreasureKeywordLabels(item.system.keywords, item.system.category, item.system.kind),
      source: "world",
      sourceLabel: game.i18n.localize("DSHIDEOUT.TreasureBrowser.SourceWorld"),
      hasCraftingData: !!item.system.project?.goal,
      projectData: item.system.project ?? null,
    });
  }

  _treasureCachedIndex = entries;
  return entries;
}

export function getTreasureSourceOptions(index) {
  const map = new Map();
  for (const entry of index) {
    if (!map.has(entry.source)) {
      map.set(entry.source, {
        value: entry.source,
        label: entry.sourceLabel,
        isDefault: DEFAULT_TREASURE_PACK_IDS.has(entry.source),
      });
    }
  }
  return [...map.values()];
}

export class TreasureBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {{ hideoutApp: import("../hideout/hideout-app.mjs").HideoutApp }} options */
  constructor(options = {}) {
    super(options);
    this.#hideoutApp = options.hideoutApp;
  }

  #hideoutApp;
  #index = [];
  #loaded = false;
  #searchText = "";
  #categoryFilter = "";
  #echelonFilter = 0;
  #sourceFilters = new Set();
  #selectedUuid = null;
  #searchFocused = false;
  /** Cached filtered+enriched entries from last _prepareContext â€” used for footer DOM update. */
  #filteredEntries = [];

  static DEFAULT_OPTIONS = {
    id: "dshideout-treasure-browser",
    classes: ["draw-steel-hideout", "dshideout-browser"],
    position: { width: 700, height: 650 },
    window: {
      title: "DSHIDEOUT.TreasureBrowser.Title",
      resizable: true,
      icon: "fa-solid fa-gem",
    },
    actions: {
      selectRow: TreasureBrowserApp.#onSelectRow,
      addSelectedAsProject: TreasureBrowserApp.#onAddSelectedAsProject,
      addSelectedToStash: TreasureBrowserApp.#onAddSelectedToStash,
      addSelectedToArchives: TreasureBrowserApp.#onAddSelectedToArchives,
      clearSearch: TreasureBrowserApp.#onClearSearch,
      removeSource: TreasureBrowserApp.#onRemoveSource,
      resetFilters: TreasureBrowserApp.#onResetFilters,
    },
  };

  static PARTS = {
    browser: {
      template: `modules/${MODULE_ID}/templates/browsers/treasure-browser.hbs`,
      scrollable: [".dshideout-browser-list"],
    },
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    if (!this.#loaded) {
      this.#index = await loadTreasureIndex();
      _treasureCachedSourceOptions = getTreasureSourceOptions(this.#index);
      this.#loaded = true;

      // Restore persisted filters from client setting.
      const stored = game.settings.get(MODULE_ID, SETTINGS.TREASURE_BROWSER_FILTERS) ?? {};
      const validSourceValues = new Set((_treasureCachedSourceOptions ?? []).map(s => s.value));
      let restored = false;
      if (typeof stored.categoryFilter === "string") {
        this.#categoryFilter = stored.categoryFilter;
        restored = true;
      }
      if (Number.isFinite(stored.echelonFilter)) {
        this.#echelonFilter = stored.echelonFilter;
        restored = true;
      }
      if (Array.isArray(stored.sourceFilters)) {
        for (const v of stored.sourceFilters) {
          if (validSourceValues.has(v)) this.#sourceFilters.add(v);
        }
        restored = true;
      }

      if (!restored && this.#sourceFilters.size === 0) {
        for (const s of _treasureCachedSourceOptions) {
          if (s.isDefault) this.#sourceFilters.add(s.value);
        }
        if (this.#sourceFilters.size === 0) {
          for (const s of _treasureCachedSourceOptions) this.#sourceFilters.add(s.value);
        }
      }
    }

    // Build category options from system config
    const categoryOptions = [
      { value: "", label: game.i18n.localize("DSHIDEOUT.TreasureBrowser.FilterAllTypes") },
      ...Object.entries(ds.CONFIG.equipment.categories ?? {}).map(([value, cat]) => ({
        value,
        label: cat.label ?? value,
      })),
    ];

    // Build echelon filter options (echelons 1â€“4)
    const echelonOptions = [
      { value: 0, label: game.i18n.localize("DSHIDEOUT.TreasureBrowser.FilterAllEchelons") },
      ...[1, 2, 3, 4].map(n => ({ value: n, label: `${game.i18n.localize("DSHIDEOUT.TreasureBrowser.Echelon")} ${n}` })),
    ];

    let filtered = this.#index;
    if (this.#categoryFilter) filtered = filtered.filter(e => e.category === this.#categoryFilter);
    if (this.#echelonFilter) filtered = filtered.filter(e => e.echelon === this.#echelonFilter);
    if (this.#sourceFilters.size > 0) filtered = filtered.filter(e => this.#sourceFilters.has(e.source));
    if (this.#searchText) {
      const q = this.#searchText.toLowerCase();
      filtered = filtered.filter(e => e.name.toLowerCase().includes(q));
    }

    // Alphabetical sort
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

    // Deselect if selected item is not in filtered results
    if (this.#selectedUuid && !filtered.some(e => e.uuid === this.#selectedUuid)) {
      this.#selectedUuid = null;
    }

    const enrichedEntries = filtered.map(e => ({
      ...e,
      categoryLabel: ds.CONFIG.equipment.categories?.[e.category]?.label ?? e.category,
      echelonLabel: e.echelon ? `E${e.echelon}` : "",
      isSelected: e.uuid === this.#selectedUuid,
      projectSource: e.projectData?.projectSource ?? e.projectData?.source ?? null,
      projectGoal: e.projectData?.goal ?? null,
      projectPrerequisites: e.projectData?.prerequisites ?? null,
    }));

    // Cache for DOM-based row selection (avoids re-render for animation)
    this.#filteredEntries = enrichedEntries;

    const selectedEntry = this.#selectedUuid
      ? enrichedEntries.find(e => e.uuid === this.#selectedUuid) ?? null
      : null;

    // Enrich description for selected entry
    if (selectedEntry?.description) {
      selectedEntry.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(selectedEntry.description, { async: true })
        .catch(() => selectedEntry.description);
    }

    return {
      entries: enrichedEntries,
      totalCount: filtered.length,
      categoryFilter: this.#categoryFilter,
      categoryOptions,
      echelonFilter: this.#echelonFilter,
      echelonOptions,
      sourceChips: (_treasureCachedSourceOptions ?? []).filter(s => this.#sourceFilters.has(s.value)),
      availableSources: (_treasureCachedSourceOptions ?? []).filter(s => !this.#sourceFilters.has(s.value)),
      searchText: this.#searchText,
      isLoading: !this.#loaded,
      isGM: hasGMPermission(),
      selectedEntry,
      selectedUuid: this.#selectedUuid,
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    // Suppress transition on initial paint so collapsible snaps to state
    for (const el of this.element.querySelectorAll(".dshideout-collapsible")) {
      el.classList.add("no-transition");
      requestAnimationFrame(() => el.classList.remove("no-transition"));
    }

    const el = this.element;

    const searchInput = el.querySelector(".dshideout-browser-search");
    if (searchInput) {
      // Restore focus after re-render if search was active
      if (this.#searchFocused) {
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
        this.#searchFocused = false;
      }

      searchInput.addEventListener("input", (e) => {
        this.#searchText = e.target.value;
        this.#searchFocused = true;
        this.render();
      });
    }

    const catSelect = el.querySelector("[name='categoryFilter']");
    if (catSelect) {
      catSelect.addEventListener("change", (e) => {
        this.#categoryFilter = e.target.value;
        this.#saveFilters();
        this.render();
      });
    }

    const echelonSelect = el.querySelector("[name='echelonFilter']");
    if (echelonSelect) {
      echelonSelect.addEventListener("change", (e) => {
        this.#echelonFilter = parseInt(e.target.value) || 0;
        this.#saveFilters();
        this.render();
      });
    }

    // Source add select
    const sourceAddSelect = el.querySelector("[name='addSource']");
    if (sourceAddSelect) {
      sourceAddSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val) {
          this.#sourceFilters.add(val);
          e.target.value = "";
          this.#saveFilters();
          this.render();
        }
      });
    }

    // Row drag — emits standard Foundry item data so hideout drop zones and
    // the Foundry Items sidebar both accept the drop.
    for (const row of el.querySelectorAll(".dshideout-browser-row[data-uuid]")) {
      row.addEventListener("dragstart", (e) => {
        const uuid = row.dataset.uuid;
        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
        e.dataTransfer.effectAllowed = "copy";
      });
    }
  }

  static #onRemoveSource(event, target) {
    this.#sourceFilters.delete(target.dataset.source);
    this.#saveFilters();
    this.render();
  }

  static #onResetFilters(event, target) {
    this.#categoryFilter = "";
    this.#echelonFilter = 0;
    this.#sourceFilters.clear();
    for (const s of (_treasureCachedSourceOptions ?? [])) {
      if (s.isDefault) this.#sourceFilters.add(s.value);
    }
    if (this.#sourceFilters.size === 0) {
      for (const s of (_treasureCachedSourceOptions ?? [])) this.#sourceFilters.add(s.value);
    }
    this.#saveFilters();
    this.render();
  }

  /** Persist current filter state to the client setting (fire-and-forget). */
  #saveFilters() {
    try {
      game.settings.set(MODULE_ID, SETTINGS.TREASURE_BROWSER_FILTERS, {
        categoryFilter: this.#categoryFilter ?? "",
        echelonFilter: this.#echelonFilter ?? 0,
        sourceFilters: Array.from(this.#sourceFilters),
      });
    } catch (err) {
      console.warn("draw-steel-hideout | Failed to persist treasure browser filters:", err);
    }
  }

  static async #onSelectRow(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const wasSelected = this.#selectedUuid === uuid;
    this.#selectedUuid = wasSelected ? null : uuid;

    // Animate via DOM toggle â€” no full re-render needed for the list
    for (const row of this.element.querySelectorAll(".dshideout-browser-row")) {
      const isNow = row.dataset.uuid === this.#selectedUuid;
      row.classList.toggle("is-selected", isNow);
      const coll = row.querySelector(".dshideout-collapsible");
      if (coll) coll.classList.toggle("is-expanded", isNow);
    }

    // Enrich the description for the newly-expanded row, then scroll into view
    if (this.#selectedUuid) {
      const selectedRow = this.element.querySelector(`.dshideout-browser-row[data-uuid="${this.#selectedUuid}"]`);
      const descEl = selectedRow?.querySelector(".dshideout-browser-description");
      const entry = this.#filteredEntries.find(e => e.uuid === this.#selectedUuid);
      if (descEl && entry?.description) {
        const enriched = await foundry.applications.ux.TextEditor.implementation
          .enrichHTML(entry.description, { async: true })
          .catch(() => entry.description);
        descEl.innerHTML = enriched;
      }
      if (selectedRow) {
        const doScroll = () => selectedRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const collapsing = [...this.element.querySelectorAll(".dshideout-collapsible:not(.is-expanded)")]
          .find(el => el.getBoundingClientRect().height > 0);
        if (collapsing) {
          collapsing.addEventListener("transitionend", doScroll, { once: true });
          setTimeout(doScroll, 300);
        } else {
          requestAnimationFrame(doScroll);
        }
      }
    }

    // Update footer via direct DOM â€” avoids re-render flash
    const footer = this.element.querySelector(".dshideout-browser-footer");
    if (!footer) return;
    const entry = this.#selectedUuid
      ? this.#filteredEntries.find(e => e.uuid === this.#selectedUuid)
      : null;
    if (entry) {
      const craftBtn = entry.hasCraftingData ? `
        <button type="button" class="dshideout-btn dshideout-btn-secondary" data-action="addSelectedAsProject">
          <i class="fas fa-scroll"></i> ${game.i18n.localize("DSHIDEOUT.TreasureBrowser.AddAsProject")}
        </button>` : "";
      footer.innerHTML = `
        <span class="dshideout-footer-item-name">${foundry.utils.escapeHTML(entry.name)}</span>
        ${craftBtn}
        <button type="button" class="dshideout-btn dshideout-btn-secondary" data-action="addSelectedToArchives">
          <i class="fas fa-book-open"></i> ${game.i18n.localize("DSHIDEOUT.TreasureBrowser.AddToArchives")}
        </button>
        <button type="button" class="dshideout-btn dshideout-btn-secondary" data-action="addSelectedToStash">
          <i class="fas fa-box-open"></i> ${game.i18n.localize("DSHIDEOUT.TreasureBrowser.AddToStash")}
        </button>
      `;
    } else {
      footer.innerHTML = `<span class="dshideout-footer-hint">${game.i18n.localize("DSHIDEOUT.TreasureBrowser.SelectHint")}</span>`;
    }
  }

  static #onClearSearch(event, target) {
    this.#searchText = "";
    this.render();
  }

  static async #onAddSelectedAsProject(event, target) {
    if (!this.#selectedUuid) return;
    const item = await fromUuid(this.#selectedUuid);
    if (!item) return;
    await this.#hideoutApp._addTreasureAsProject(item);
    this.close();
  }

  static async #onAddSelectedToStash(event, target) {
    if (!hasGMPermission()) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Stash.PlayerCannotAdd"));
      return;
    }
    if (!this.#selectedUuid) return;
    const item = await fromUuid(this.#selectedUuid);
    if (!item) return;

    await addStashItem({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      description: item.system.description?.value ?? "",
      category: item.system.category ?? "",
      echelon: item.system.echelon ?? 0,
      keywords: _getTreasureKeywordLabels(item.system.keywords, item.system.category, item.system.kind),
    });

    ui.notifications.info(game.i18n.format("DSHIDEOUT.Stash.ItemDropped", { name: item.name }));
    this.#hideoutApp?.render({ parts: ["main"] });
    this.close();
  }

  static async #onAddSelectedToArchives(event, target) {
    if (!hasGMPermission()) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Archives.PlayerCannotAdd"));
      return;
    }
    if (!this.#selectedUuid) return;
    const item = await fromUuid(this.#selectedUuid);
    if (!item) return;

    const added = await addArchiveEntry({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      description: item.system.description?.value ?? "",
      category: item.system.category ?? "",
      echelon: item.system.echelon ?? 0,
      keywords: _getTreasureKeywordLabels(item.system.keywords, item.system.category, item.system.kind),
      hasCraftingData: !!item.system.project?.goal,
      projectData: item.system.project ?? null,
    });

    if (!added) {
      ui.notifications.warn(game.i18n.format("DSHIDEOUT.Archives.AlreadyAdded", { name: item.name }));
      return;
    }

    ui.notifications.info(game.i18n.format("DSHIDEOUT.Archives.ItemAdded", { name: item.name }));
    this.#hideoutApp?.render({ parts: ["main"] });
    this.close();
  }
}
