/**
 * Draw Steel – Hideout
 * Project Settings dialog: GM-only editor for advanced project options
 * (additional detail, event mode, event table, private/public posting).
 */

import { MODULE_ID } from "../config.mjs";
import { updateProject, getProjects } from "../hideout/project-manager.mjs";
import { listEventTables, findDefaultEventTableUuid } from "../hideout/project-events.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ProjectSettingsDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dshideout-project-settings",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 520, height: "auto" },
    window: {
      title: "DSHIDEOUT.Projects.SettingsTitle",
      resizable: false,
      icon: "fa-solid fa-cog",
    },
    actions: {
      saveSettings: ProjectSettingsDialog.#onSaveSettings,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/dialogs/project-settings.hbs`,
    },
    footer: {
      template: `modules/${MODULE_ID}/templates/dialogs/project-settings-footer.hbs`,
    },
  };

  #project;
  #hideoutApp;
  #tables = [];

  constructor({ project, hideoutApp, ...options } = {}) {
    super(options);
    this.#project = project;
    this.#hideoutApp = hideoutApp;
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    if (!this.#tables.length) {
      this.#tables = await listEventTables();
    }

    // Ensure the project's currently-stored UUID is present in the dropdown
    // even if the table has been deleted/renamed since (so we can show "Unknown").
    let currentUuid = this.#project.eventTableUuid ?? null;
    if (!currentUuid) {
      currentUuid = await findDefaultEventTableUuid(this.#project.name);
    }
    let tables = this.#tables.slice();
    if (currentUuid && !tables.some(t => t.uuid === currentUuid)) {
      tables.unshift({ uuid: currentUuid, name: `(missing) ${currentUuid}`, source: "?" });
    }

    return {
      project: this.#project,
      tables,
      currentUuid,
      eventModeChoices: [
        { value: "disabled",   label: "DSHIDEOUT.Events.ModeDisabled" },
        { value: "milestone",  label: "DSHIDEOUT.Events.ModeMilestone" },
        { value: "d6",         label: "DSHIDEOUT.Events.ModeD6" },
        { value: "guaranteed", label: "DSHIDEOUT.Events.ModeGuaranteed" },
      ],
      currentMode: this.#project.eventsMode ?? "disabled",
      postPrivate: this.#project.postEventsPrivate !== false,
      additionalDetail: this.#project.additionalDetail ?? "",
    };
  }

  /* -------------------------------------------------- */
  /*  Save                                              */
  /* -------------------------------------------------- */

  static async #onSaveSettings(event, target) {
    const form = this.element.querySelector("form.dshideout-project-settings-form");
    if (!form) return;

    const additionalDetail = (form.elements["additionalDetail"]?.value ?? "").trim();
    const eventsMode       = form.elements["eventsMode"]?.value ?? "disabled";
    const eventTableUuid   = form.elements["eventTableUuid"]?.value || null;
    const postEventsPrivate = !!form.elements["postEventsPrivate"]?.checked;

    // Reset milestone tracking when the table changes — old milestones fired
    // for the old table shouldn't block the new table.
    const changes = { additionalDetail, eventsMode, eventTableUuid, postEventsPrivate };
    if (eventTableUuid !== this.#project.eventTableUuid) {
      changes.eventsTriggeredMilestones = [];
    }

    await updateProject(this.#project.id, changes);

    ui.notifications.info(game.i18n.localize("DSHIDEOUT.Projects.SettingsSaved"));
    this.#hideoutApp?.render({ parts: ["main"] });
    await this.close();
  }
}
