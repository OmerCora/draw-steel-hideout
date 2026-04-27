/**
 * Draw Steel – Hideout
 * Individual Project Roll dialog: a single contributor rolls 2d10 + characteristic
 * for a single project. Mirrors the Progress Projects roll pipeline minus
 * project-event resolution. After the roll, the contributor is marked as
 * having rolled individually for that project.
 */

import { MODULE_ID, CHARACTERISTIC_ROLL_KEYS } from "../config.mjs";
import { getProjects, markIndividualRoll } from "../hideout/project-manager.mjs";
import { executeRollPipeline } from "../hideout/project-roll-helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class IndividualProjectRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {{ actorId: string, projectId: string, hideoutApp?: any }} options */
  constructor(options = {}) {
    super(options);
    this.#actorId = options.actorId;
    this.#projectId = options.projectId;
    this.#hideoutApp = options.hideoutApp;
  }

  #actorId;
  #projectId;
  #hideoutApp;
  #rollOptions = { edges: 0, banes: 0 };

  static DEFAULT_OPTIONS = {
    id: "dshideout-individual-project-roll",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 500, height: "auto" },
    window: {
      title: "DSHIDEOUT.IndividualRoll.Title",
      resizable: false,
      icon: "fa-solid fa-dice-d20",
    },
    actions: {
      roll: IndividualProjectRollDialog.#onRoll,
    },
  };

  static PARTS = {
    dialog: {
      template: `modules/${MODULE_ID}/templates/dialogs/individual-project-roll.hbs`,
    },
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    const project = getProjects().find(p => p.id === this.#projectId);
    const actor = game.actors.get(this.#actorId) ?? game.items.get(this.#actorId);
    if (!project || !actor) {
      return { hasError: true };
    }

    const chars = project.rollCharacteristic ?? [];
    const bestChar = chars.reduce((best, c) => {
      const val = actor.system.characteristics?.[c]?.value ?? 0;
      return val > (best?.value ?? -Infinity) ? { key: c, value: val } : best;
    }, null);
    const charList = bestChar ? [{
      key: bestChar.key,
      label: ds.CONFIG.characteristics[bestChar.key]?.label ?? bestChar.key,
      rollKey: CHARACTERISTIC_ROLL_KEYS[bestChar.key] ?? bestChar.key.charAt(0).toUpperCase(),
      value: bestChar.value,
    }] : [];

    return {
      hasError: false,
      project: {
        id: project.id,
        name: project.name,
        progress: project.goal ? `${project.points}/${project.goal}` : `${project.points}`,
        progressPct: project.goal ? Math.min(100, Math.round((project.points / project.goal) * 100)) : 0,
      },
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
      },
      charList,
      edges: this.#rollOptions.edges,
      banes: this.#rollOptions.banes,
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    for (const sel of el.querySelectorAll("[data-roll-option]")) {
      sel.addEventListener("change", (e) => {
        const option = e.target.dataset.rollOption;
        if (!option) return;
        this.#rollOptions[option] = parseInt(e.target.value) || 0;
      });
    }
  }

  /* -------------------------------------------------- */
  /*  Rolling                                           */
  /* -------------------------------------------------- */

  static async #onRoll(event, target) {
    if (target.disabled) return;
    target.disabled = true;
    const originalHTML = target.innerHTML;
    target.innerHTML = `<i class="fas fa-cog fa-spin"></i> ${game.i18n.localize("DSHIDEOUT.ProgressProjects.RollInProgress")}`;

    try {
      await IndividualProjectRollDialog.#runRoll.call(this);
    } catch (err) {
      console.error("draw-steel-hideout | Individual project roll failed:", err);
      ui.notifications.error(game.i18n.localize("DSHIDEOUT.IndividualRoll.RollFailed"));
      if (!this.closing && this.rendered) {
        target.disabled = false;
        target.innerHTML = originalHTML;
      }
    }
  }

  static async #runRoll() {
    const project = getProjects().find(p => p.id === this.#projectId);
    const actor = game.actors.get(this.#actorId) ?? game.items.get(this.#actorId);
    if (!project || !actor) {
      await this.close();
      return;
    }

    const chars = project.rollCharacteristic ?? [];
    const bestCharKey = chars.length
      ? chars.reduce((best, c) => {
          const val = actor.system.characteristics?.[c]?.value ?? 0;
          return val > (actor.system.characteristics?.[best]?.value ?? -Infinity) ? c : best;
        }, chars[0])
      : "might";
    const rollKey = CHARACTERISTIC_ROLL_KEYS[bestCharKey] ?? "M";
    const formula = `2d10 + @${rollKey}`;
    // Items don't have getRollData(); build minimal rollData from characteristics.
    const rollData = actor.getRollData?.() ?? {
      M: actor.system.characteristics?.might?.value ?? 0,
      A: actor.system.characteristics?.agility?.value ?? 0,
      R: actor.system.characteristics?.reason?.value ?? 0,
      I: actor.system.characteristics?.intuition?.value ?? 0,
      P: actor.system.characteristics?.presence?.value ?? 0,
    };

    const cfg = {
      actor,
      project,
      opts: { edges: this.#rollOptions.edges, banes: this.#rollOptions.banes },
      charKey: bestCharKey,
      formula,
      rollData,
    };

    await this.close();

    await executeRollPipeline([cfg], {
      headerOverride: game.i18n.localize("DSHIDEOUT.IndividualRoll.ChatHeader"),
    });

    await markIndividualRoll(this.#projectId, this.#actorId);
  }
}
