/**
 * Draw Steel – Hideout
 * Default Treasure Browser Filters dialog: GM-only editor for the world-level
 * defaults applied when "Reset Filters" is clicked in the Treasure Browser.
 */

import { MODULE_ID, SETTINGS, TREASURE_BROWSER_FILTER_DEFAULTS } from "../config.mjs";
import { getTreasureBrowserSources } from "../browsers/treasure-browser.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DefaultTreasureBrowserFiltersDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dshideout-default-treasure-browser-filters",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      title: "DSHIDEOUT.Settings.DefaultTreasureBrowserFilters.DialogTitle",
      resizable: false,
      icon: "fa-solid fa-filter",
    },
    actions: {
      saveDefaults: DefaultTreasureBrowserFiltersDialog.#onSave,
      resetDefaults: DefaultTreasureBrowserFiltersDialog.#onReset,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-treasure-browser-filters.hbs`,
    },
    footer: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-browser-filters-footer.hbs`,
    },
  };

  #getCurrent() {
    const stored = game.settings.get(MODULE_ID, SETTINGS.DEFAULT_TREASURE_BROWSER_FILTERS) ?? {};
    return foundry.utils.mergeObject(
      foundry.utils.deepClone({ ...TREASURE_BROWSER_FILTER_DEFAULTS }),
      stored,
      { inplace: false },
    );
  }

  async _prepareContext(options) {
    const current = this.#getCurrent();
    const storedSources = new Set(current.sourceFilters ?? TREASURE_BROWSER_FILTER_DEFAULTS.sourceFilters);

    const allSources = await getTreasureBrowserSources();
    const packOptions = allSources.map(s => ({
      value: s.value,
      label: s.label,
      checked: storedSources.has(s.value),
    }));

    const categoryOptions = [
      { value: "", label: game.i18n.localize("DSHIDEOUT.TreasureBrowser.FilterAllTypes") },
      ...Object.entries(ds.CONFIG.equipment.categories ?? {}).map(([value, cat]) => ({
        value,
        label: cat.label ?? value,
      })),
    ];

    const echelonOptions = [
      { value: 0, label: game.i18n.localize("DSHIDEOUT.TreasureBrowser.FilterAllEchelons") },
      ...[1, 2, 3, 4].map(n => ({
        value: n,
        label: `${game.i18n.localize("DSHIDEOUT.TreasureBrowser.Echelon")} ${n}`,
      })),
    ];

    return {
      categoryFilter: current.categoryFilter ?? "",
      echelonFilter: current.echelonFilter ?? 0,
      categoryOptions,
      echelonOptions,
      packOptions,
    };
  }

  static async #onSave(event, target) {
    const form = this.element.querySelector("form");
    if (!form) return;

    const categoryFilter = form.elements["categoryFilter"]?.value ?? "";
    const echelonFilter = parseInt(form.elements["echelonFilter"]?.value) || 0;
    const sourceInputs = form.querySelectorAll("[name='sourceFilters']:checked");
    const sourceFilters = [...sourceInputs].map(el => el.value);

    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_TREASURE_BROWSER_FILTERS, {
      categoryFilter,
      echelonFilter,
      sourceFilters,
    });
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultTreasureBrowserFilters.Saved"));
    await this.close();
  }

  static async #onReset(event, target) {
    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_TREASURE_BROWSER_FILTERS, { ...TREASURE_BROWSER_FILTER_DEFAULTS });
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultTreasureBrowserFilters.ResetDone"));
    this.render({ force: true });
  }
}
