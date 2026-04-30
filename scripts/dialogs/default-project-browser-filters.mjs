/**
 * Draw Steel – Hideout
 * Default Project Browser Filters dialog: GM-only editor for the world-level
 * defaults applied when "Reset Filters" is clicked in the Project Browser.
 */

import { MODULE_ID, SETTINGS, PROJECT_BROWSER_FILTER_DEFAULTS } from "../config.mjs";
import { getProjectBrowserSources } from "../browsers/project-browser.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DefaultProjectBrowserFiltersDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dshideout-default-project-browser-filters",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 480, height: "auto" },
    window: {
      title: "DSHIDEOUT.Settings.DefaultProjectBrowserFilters.DialogTitle",
      resizable: false,
      icon: "fa-solid fa-filter",
    },
    actions: {
      saveDefaults: DefaultProjectBrowserFiltersDialog.#onSave,
      resetDefaults: DefaultProjectBrowserFiltersDialog.#onReset,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-project-browser-filters.hbs`,
    },
    footer: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-browser-filters-footer.hbs`,
    },
  };

  #getCurrent() {
    const stored = game.settings.get(MODULE_ID, SETTINGS.DEFAULT_PROJECT_BROWSER_FILTERS) ?? {};
    return foundry.utils.mergeObject(
      foundry.utils.deepClone({ ...PROJECT_BROWSER_FILTER_DEFAULTS }),
      stored,
      { inplace: false },
    );
  }

  async _prepareContext(options) {
    const current = this.#getCurrent();
    const storedSources = new Set(current.sourceFilters ?? PROJECT_BROWSER_FILTER_DEFAULTS.sourceFilters);

    const allSources = await getProjectBrowserSources();
    const packOptions = allSources.map(s => ({
      value: s.value,
      label: s.label,
      checked: storedSources.has(s.value),
    }));

    const typeOptions = [
      { value: "", label: game.i18n.localize("DSHIDEOUT.ProjectBrowser.FilterAllTypes") },
      ...Object.entries(ds.CONFIG.projects.types).map(([value, { label }]) => ({ value, label })),
    ];

    return {
      typeFilter: current.typeFilter ?? "",
      typeOptions,
      packOptions,
    };
  }

  static async #onSave(event, target) {
    const form = this.element.querySelector("form");
    if (!form) return;

    const typeFilter = form.elements["typeFilter"]?.value ?? "";
    const sourceInputs = form.querySelectorAll("[name='sourceFilters']:checked");
    const sourceFilters = [...sourceInputs].map(el => el.value);

    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_PROJECT_BROWSER_FILTERS, {
      typeFilter,
      sourceFilters,
    });
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultProjectBrowserFilters.Saved"));
    await this.close();
  }

  static async #onReset(event, target) {
    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_PROJECT_BROWSER_FILTERS, { ...PROJECT_BROWSER_FILTER_DEFAULTS });
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultProjectBrowserFilters.ResetDone"));
    this.render({ force: true });
  }
}
