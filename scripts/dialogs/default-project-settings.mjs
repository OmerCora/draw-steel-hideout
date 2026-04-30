/**
 * Draw Steel – Hideout
 * Default Project Settings dialog: GM-only editor for the world-level
 * defaults applied to any newly-created project. Mirrors the per-project
 * Project Settings dialog but writes to a world setting instead of one
 * project, and adds a Reset to Defaults button.
 */

import { MODULE_ID, SETTINGS, PROJECT_SETTING_DEFAULTS } from "../config.mjs";
import { listEventTables } from "../hideout/project-events.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DefaultProjectSettingsDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dshideout-default-project-settings",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 540, height: "auto" },
    window: {
      title: "DSHIDEOUT.Settings.DefaultProjectSettings.DialogTitle",
      resizable: false,
      icon: "fa-solid fa-sliders",
    },
    actions: {
      saveDefaults: DefaultProjectSettingsDialog.#onSave,
      resetDefaults: DefaultProjectSettingsDialog.#onReset,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-project-settings.hbs`,
    },
    footer: {
      template: `modules/${MODULE_ID}/templates/dialogs/default-project-settings-footer.hbs`,
    },
  };

  #tables = [];

  /** Read the current saved defaults, merged on top of factory defaults. */
  #getCurrent() {
    const stored = game.settings.get(MODULE_ID, SETTINGS.DEFAULT_PROJECT_SETTINGS) ?? {};
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(PROJECT_SETTING_DEFAULTS),
      stored,
      { inplace: false },
    );
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    if (!this.#tables.length) this.#tables = await listEventTables();
    const current = this.#getCurrent();

    let tables = this.#tables.slice();
    const currentUuid = current.eventTableUuid ?? null;
    if (currentUuid && !tables.some(t => t.uuid === currentUuid)) {
      tables.unshift({ uuid: currentUuid, name: `(missing) ${currentUuid}`, source: "?" });
    }
    // Allow "no default" entry so a freshly-created project can fall back to
    // findDefaultEventTableUuid by name.
    tables.unshift({ uuid: "", name: game.i18n.localize("DSHIDEOUT.Settings.DefaultProjectSettings.NoTable"), source: "" });

    return {
      tables,
      currentUuid: current.eventTableUuid ?? "",
      currentMode: current.eventsMode ?? "disabled",
      postPrivate: current.postEventsPrivate !== false,
      carryOverflow: !!current.carryOverflow,
      eventModeChoices: [
        { value: "disabled",   label: "DSHIDEOUT.Events.ModeDisabled" },
        { value: "milestone",  label: "DSHIDEOUT.Events.ModeMilestone" },
        { value: "d6",         label: "DSHIDEOUT.Events.ModeD6" },
        { value: "guaranteed", label: "DSHIDEOUT.Events.ModeGuaranteed" },
      ],
    };
  }

  /* -------------------------------------------------- */

  static async #onSave(event, target) {
    const form = this.element.querySelector("form.dshideout-default-project-settings-form");
    if (!form) return;

    const next = {
      eventsMode: form.elements["eventsMode"]?.value ?? "disabled",
      eventTableUuid: form.elements["eventTableUuid"]?.value || null,
      postEventsPrivate: !!form.elements["postEventsPrivate"]?.checked,
      carryOverflow: !!form.elements["carryOverflow"]?.checked,
    };

    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_PROJECT_SETTINGS, next);
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultProjectSettings.Saved"));
    await this.close();
  }

  static async #onReset(event, target) {
    await game.settings.set(MODULE_ID, SETTINGS.DEFAULT_PROJECT_SETTINGS, { ...PROJECT_SETTING_DEFAULTS });
    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Settings.DefaultProjectSettings.Reset"));
    this.render({ force: true });
  }
}
