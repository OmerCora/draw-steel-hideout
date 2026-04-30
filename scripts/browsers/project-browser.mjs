/**
 * Draw Steel – Hideout
 * Project Browser: browse compendium/world project items and add to the Hideout tracker.
 */

import { MODULE_ID, DEFAULT_PROJECT_PACK_IDS, PROJECT_INDEX_FIELDS, SETTINGS } from "../config.mjs";
import { hasGMPermission } from "../socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @typedef {import("../hideout/project-manager.mjs").HideoutProject} HideoutProject */

/**
 * @typedef {Object} ProjectEntry
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} description
 * @property {number|null} goal
 * @property {string} type
 * @property {string[]} rollCharacteristic
 * @property {string} projectSource
 * @property {string} prerequisites
 * @property {string} source
 * @property {string} sourceLabel
 * @property {string|null} yieldItemUuid
 * @property {string} yieldAmount
 * @property {string} yieldDisplay
 */

let _cachedIndex = null;
let _cachedSourceOptions = null;

/**
 * Return the project browser source options, loading the index if not yet cached.
 * Safe to call from outside the browser app (e.g. settings dialogs).
 */
export async function getProjectBrowserSources() {
  if (_cachedSourceOptions) return _cachedSourceOptions;
  const index = await loadProjectIndex();
  _cachedSourceOptions = getProjectSourceOptions(index);
  return _cachedSourceOptions;
}

export async function loadProjectIndex() {
  const entries = [];

  const packs = game.packs.filter(pack => {
    if (pack.documentName !== "Item") return false;
    const meta = pack.metadata;
    if (meta.packageType === "system" && meta.packageName !== "draw-steel") return false;
    return true;
  });

  const results = await Promise.all(packs.map(async (pack) => {
    try {
      const index = await pack.getIndex({ fields: PROJECT_INDEX_FIELDS });
      const packId = pack.metadata.id;
      const sourceLabel = pack.title;
      const packEntries = [];

      for (const entry of index) {
        if (entry.type !== "project") continue;
        packEntries.push({
          uuid: `Compendium.${pack.metadata.id}.Item.${entry._id}`,
          name: entry.name,
          img: entry.img || "icons/svg/item-bag.svg",
          description: entry.system?.description?.value ?? "",
          goal: entry.system?.goal ?? null,
          type: entry.system?.type ?? "other",
          rollCharacteristic: Array.from(entry.system?.rollCharacteristic ?? []),
          projectSource: entry.system?.projectSource ?? "",
          prerequisites: entry.system?.prerequisites ?? "",
          source: packId,
          sourceLabel,
          yieldItemUuid: entry.system?.yield?.item ?? null,
          yieldAmount: entry.system?.yield?.amount ?? "1",
          yieldDisplay: entry.system?.yield?.display ?? "",
        });
      }
      return packEntries;
    } catch (err) {
      console.warn(`draw-steel-hideout | Failed to index pack ${pack.metadata.id}:`, err);
      return [];
    }
  }));

  for (const r of results) entries.push(...r);

  // World projects
  for (const item of game.items) {
    if (item.type !== "project") continue;
    entries.push({
      uuid: item.uuid,
      name: item.name,
      img: item.img || "icons/svg/item-bag.svg",
      description: item.system.description?.value ?? "",
      goal: item.system.goal ?? null,
      type: item.system.type ?? "other",
      rollCharacteristic: Array.from(item.system.rollCharacteristic ?? []),
      projectSource: item.system.projectSource ?? "",
      prerequisites: item.system.prerequisites ?? "",
      source: "world",
      sourceLabel: game.i18n.localize("DSHIDEOUT.ProjectBrowser.SourceWorld"),
      yieldItemUuid: item.system.yield?.item ?? null,
      yieldAmount: item.system.yield?.amount ?? "1",
      yieldDisplay: item.system.yield?.display ?? "",
    });
  }

  _cachedIndex = entries;
  return entries;
}

export function getProjectSourceOptions(index) {
  const map = new Map();
  for (const entry of index) {
    if (!map.has(entry.source)) {
      map.set(entry.source, {
        value: entry.source,
        label: entry.sourceLabel,
        isDefault: DEFAULT_PROJECT_PACK_IDS.has(entry.source),
      });
    }
  }
  return [...map.values()];
}

export class ProjectBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {{ hideoutApp: import("../hideout/hideout-app.mjs").HideoutApp }} options */
  constructor(options = {}) {
    super(options);
    this.#hideoutApp = options.hideoutApp;
  }

  #hideoutApp;
  #index = [];
  #loaded = false;
  #searchText = "";
  #typeFilter = "";
  #sourceFilters = new Set();
  #selectedUuid = null;
  #searchFocused = false;
  #additionalDetail = "";
  /** Cached filtered+enriched entries from last _prepareContext — used for footer DOM update. */
  #filteredEntries = [];

  static DEFAULT_OPTIONS = {
    id: "dshideout-project-browser",
    classes: ["draw-steel-hideout", "dshideout-browser"],
    position: { width: 700, height: 650 },
    window: {
      title: "DSHIDEOUT.ProjectBrowser.Title",
      resizable: true,
      icon: "fa-solid fa-scroll",
    },
    actions: {
      addSelectedProject: ProjectBrowserApp.#onAddSelectedProject,
      selectRow: ProjectBrowserApp.#onSelectRow,
      clearSearch: ProjectBrowserApp.#onClearSearch,
      removeSource: ProjectBrowserApp.#onRemoveSource,
      resetFilters: ProjectBrowserApp.#onResetFilters,
    },
  };

  static PARTS = {
    browser: {
      template: `modules/${MODULE_ID}/templates/browsers/project-browser.hbs`,
      scrollable: [".dshideout-browser-list"],
    },
  };

  async _prepareContext(options) {
    if (!this.#loaded) {
      this.#index = await loadProjectIndex();
      _cachedSourceOptions = getProjectSourceOptions(this.#index);
      this.#loaded = true;

      // Restore persisted filters from client setting (per user, per device).
      const stored = game.settings.get(MODULE_ID, SETTINGS.PROJECT_BROWSER_FILTERS) ?? {};
      const validSourceValues = new Set((_cachedSourceOptions ?? []).map(s => s.value));
      let restored = false;
      if (typeof stored.typeFilter === "string") {
        this.#typeFilter = stored.typeFilter;
        restored = true;
      }
      if (Array.isArray(stored.sourceFilters)) {
        for (const v of stored.sourceFilters) {
          if (validSourceValues.has(v)) this.#sourceFilters.add(v);
        }
        restored = true;
      }

      // Default: select all default sources (only when nothing was restored)
      if (!restored && this.#sourceFilters.size === 0) {
        for (const s of _cachedSourceOptions) {
          if (s.isDefault) this.#sourceFilters.add(s.value);
        }
        if (this.#sourceFilters.size === 0) {
          // If no defaults found, select all
          for (const s of _cachedSourceOptions) this.#sourceFilters.add(s.value);
        }
      }
    }

    const typeOptions = [
      { value: "", label: game.i18n.localize("DSHIDEOUT.ProjectBrowser.FilterAllTypes") },
      ...Object.entries(ds.CONFIG.projects.types).map(([value, { label }]) => ({ value, label })),
    ];

    let entries = this.#index;
    if (this.#typeFilter) entries = entries.filter(e => e.type === this.#typeFilter);
    if (this.#sourceFilters.size > 0) entries = entries.filter(e => this.#sourceFilters.has(e.source));
    if (this.#searchText) {
      const q = this.#searchText.toLowerCase();
      entries = entries.filter(e => e.name.toLowerCase().includes(q));
    }

    // Alphabetical sort
    entries = [...entries].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

    // Deselect if selected item is not in filtered results
    if (this.#selectedUuid && !entries.some(e => e.uuid === this.#selectedUuid)) {
      this.#selectedUuid = null;
    }

    const enrichedEntries = entries.map(e => ({
      ...e,
      typeLabel: ds.CONFIG.projects.types[e.type]?.label ?? e.type,
      charLabels: e.rollCharacteristic.map(c => ds.CONFIG.characteristics[c]?.label ?? c),
      isSelected: e.uuid === this.#selectedUuid,
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
      totalCount: entries.length,
      typeFilter: this.#typeFilter,
      typeOptions,
      sourceChips: (_cachedSourceOptions ?? []).filter(s => this.#sourceFilters.has(s.value)),
      availableSources: (_cachedSourceOptions ?? []).filter(s => !this.#sourceFilters.has(s.value)),
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

    // Search input
    const searchInput = el.querySelector(".dshideout-browser-search");
    if (searchInput) {
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

    // Type filter
    const typeSelect = el.querySelector("[name='typeFilter']");
    if (typeSelect) {
      typeSelect.addEventListener("change", (e) => {
        this.#typeFilter = e.target.value;
        this.#saveFilters();
        this.render();
      });
    }

    // Source filter select (chip add)
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

    // Detail input (rendered in footer when item is selected)
    const detailInput = el.querySelector(".dshideout-detail-input");
    if (detailInput) {
      detailInput.value = this.#additionalDetail;
      detailInput.addEventListener("input", (e) => {
        this.#additionalDetail = e.target.value;
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

  static async #onAddSelectedProject(event, target) {
    if (!this.#selectedUuid) return;
    const item = await fromUuid(this.#selectedUuid);
    if (!item) return;
    await this.#hideoutApp._addProjectFromItem(item, { additionalDetail: this.#additionalDetail.trim() });
    this.close();
  }

  static async #onSelectRow(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const wasSelected = this.#selectedUuid === uuid;
    this.#selectedUuid = wasSelected ? null : uuid;

    // Animate via DOM toggle — no full re-render needed for the list
    for (const row of this.element.querySelectorAll(".dshideout-browser-row")) {
      const isNow = row.dataset.uuid === this.#selectedUuid;
      row.classList.toggle("is-selected", isNow);
      const coll = row.querySelector(".dshideout-collapsible");
      if (coll) coll.classList.toggle("is-expanded", isNow);
    }

    // Enrich the description for the newly-expanded row
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
      // Defer scroll so the DOM has reflowed after the previous row collapses
      if (selectedRow) requestAnimationFrame(() => selectedRow.scrollIntoView({ block: "start", behavior: "smooth" }));
    }

    // Update footer via direct DOM — avoids re-render flash
    const footer = this.element.querySelector(".dshideout-browser-footer");
    if (!footer) return;
    const entry = this.#selectedUuid
      ? this.#filteredEntries.find(e => e.uuid === this.#selectedUuid)
      : null;
    if (entry) {
      this.#additionalDetail = "";
      footer.innerHTML = `
        <span class="dshideout-footer-item-name">${foundry.utils.escapeHTML(entry.name)}</span>
        <input type="text" class="dshideout-detail-input"
               placeholder="${game.i18n.localize("DSHIDEOUT.ProjectBrowser.DetailPlaceholder")}"
               value="" maxlength="80" />
        <button type="button" class="dshideout-btn dshideout-btn-primary" data-action="addSelectedProject">
          <i class="fas fa-plus"></i> ${game.i18n.localize("DSHIDEOUT.ProjectBrowser.AddProject")}
        </button>
      `;
      const detailInput = footer.querySelector(".dshideout-detail-input");
      if (detailInput) {
        detailInput.addEventListener("input", (e) => {
          this.#additionalDetail = e.target.value;
        });
      }
    } else {
      this.#additionalDetail = "";
      footer.innerHTML = `<span class="dshideout-footer-hint">${game.i18n.localize("DSHIDEOUT.ProjectBrowser.SelectHint")}</span>`;
    }
  }

  static #onClearSearch(event, target) {
    this.#searchText = "";
    this.render();
  }

  static #onRemoveSource(event, target) {
    this.#sourceFilters.delete(target.dataset.source);
    this.#saveFilters();
    this.render();
  }

  static #onResetFilters(event, target) {
    const worldDefaults = game.settings.get(MODULE_ID, SETTINGS.DEFAULT_PROJECT_BROWSER_FILTERS) ?? {};
    this.#typeFilter = worldDefaults.typeFilter ?? "";
    this.#sourceFilters.clear();
    const defaultSources = Array.isArray(worldDefaults.sourceFilters) ? worldDefaults.sourceFilters : null;
    if (defaultSources?.length) {
      const valid = new Set((_cachedSourceOptions ?? []).map(s => s.value));
      for (const v of defaultSources) {
        if (valid.has(v)) this.#sourceFilters.add(v);
      }
    }
    // Fall back to isDefault sources when no world default is configured
    if (this.#sourceFilters.size === 0) {
      for (const s of (_cachedSourceOptions ?? [])) {
        if (s.isDefault) this.#sourceFilters.add(s.value);
      }
      if (this.#sourceFilters.size === 0) {
        for (const s of (_cachedSourceOptions ?? [])) this.#sourceFilters.add(s.value);
      }
    }
    this.#saveFilters();
    this.render();
  }

  /** Persist current filter state to the client setting (fire-and-forget). */
  #saveFilters() {
    try {
      game.settings.set(MODULE_ID, SETTINGS.PROJECT_BROWSER_FILTERS, {
        typeFilter: this.#typeFilter ?? "",
        sourceFilters: Array.from(this.#sourceFilters),
      });
    } catch (err) {
      console.warn("draw-steel-hideout | Failed to persist project browser filters:", err);
    }
  }
}
