/**
 * Draw Steel â€“ Hideout
 * Progress Projects dialog: roll 2d10 + characteristic for each contributor,
 * apply breakthroughs on critical (19-20 total), update project points, post chat.
 */

import { MODULE_ID, FOLLOWER_TYPE, CHARACTERISTIC_ROLL_KEYS } from "../config.mjs";
import { getProjects, updateProject, clearAllIndividualRolls, markIndividualRoll } from "../hideout/project-manager.mjs";
import { HideoutApp } from "../hideout/hideout-app.mjs";
import {
  evaluateProjectEventTrigger,
  rollEventTable,
  postEventChatMessage,
  postProceedButtonMessage,
} from "../hideout/project-events.mjs";
import { executeRollPipeline } from "../hideout/project-roll-helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ProgressProjectsDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {{ hideoutApp: import("../hideout/hideout-app.mjs").HideoutApp }} options */
  constructor(options = {}) {
    super(options);
    this.#hideoutApp = options.hideoutApp;
  }

  #hideoutApp;

  /** Per-contributor state: actorId â†’ { edges: 0, banes: 0 } */
  #rollOptions = new Map();

  static DEFAULT_OPTIONS = {
    id: "dshideout-progress-projects",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 620, height: "auto" },
    window: {
      title: "DSHIDEOUT.ProgressProjects.Title",
      resizable: true,
      icon: "fa-solid fa-dice",
    },
    actions: {
      rollAll: ProgressProjectsDialog.#onRollAll,
      rollFollowers: ProgressProjectsDialog.#onRollFollowers,
    },
  };

  static PARTS = {
    dialog: {
      template: `modules/${MODULE_ID}/templates/dialogs/progress-projects.hbs`,
    },
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    const projects = getProjects().filter(p => !p.completed && p.contributorIds.length > 0);

    const groups = [];
    let totalRows = 0;
    let pendingRows = 0;
    let pendingFollowerRows = 0;

    for (const project of projects) {
      const groupRows = [];
      let rowIndex = 0;
      const rolledIds = new Set(project.individuallyRolledIds ?? []);
      for (const actorId of project.contributorIds) {
        const actor = game.actors.get(actorId) ?? game.items.get(actorId);
        if (!actor) continue;
        const isFollower = actor.type === FOLLOWER_TYPE || actor.type === "follower";

        if (!this.#rollOptions.has(actorId)) {
          this.#rollOptions.set(actorId, { edges: 0, banes: 0, skill: "" });
        }
        const opts = this.#rollOptions.get(actorId);
        // Backfill skill key if this map entry pre-dates the skill column.
        if (!("skill" in opts)) opts.skill = "";

        // Build per-actor skill options. Followers (actor + item) and heroes
        // all expose `system.skills.value` as a Set of skill keys.
        const skillKeys = Array.from(actor.system.skills?.value ?? []);
        const skillOptions = [{ key: "", label: game.i18n.localize("DSHIDEOUT.ProgressProjects.SkillNone") }];
        for (const key of skillKeys) {
          const label = ds.CONFIG.skills?.list?.[key]?.label ?? key;
          skillOptions.push({ key, label });
        }
        skillOptions.sort((a, b) => {
          if (!a.key) return -1;
          if (!b.key) return 1;
          return a.label.localeCompare(b.label, game.i18n.lang);
        });

        // Show only the single highest-value applicable characteristic for this actor
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

        const alreadyRolled = rolledIds.has(actorId);

        groupRows.push({
          actorId,
          actorName: actor.name,
          actorImg: actor.img,
          projectId: project.id,
          charList,
          edges: opts.edges,
          banes: opts.banes,
          skill: opts.skill ?? "",
          skillOptions,
          isEvenRow: rowIndex % 2 === 0,
          alreadyRolled,
          isFollower,
        });
        rowIndex++;
        if (!alreadyRolled) {
          pendingRows++;
          if (isFollower) pendingFollowerRows++;
        }
      }

      if (groupRows.length === 0) continue;

      groups.push({
        projectId: project.id,
        projectName: project.name,
        progress: project.goal ? `${project.points}/${project.goal}` : `${project.points}`,
        progressPct: project.goal ? Math.min(100, Math.round((project.points / project.goal) * 100)) : 0,
        rows: groupRows,
      });
      totalRows += groupRows.length;
    }

    const allAlreadyRolled = totalRows > 0 && pendingRows === 0;

    return {
      groups,
      hasRows: totalRows > 0,
      allAlreadyRolled,
      hasPendingFollowers: pendingFollowerRows > 0,
      rollButtonLabel: allAlreadyRolled
        ? game.i18n.localize("DSHIDEOUT.ProgressProjects.ResetProjectRolls")
        : game.i18n.localize("DSHIDEOUT.ProgressProjects.RollForAll"),
      rollButtonIcon: allAlreadyRolled ? "fa-rotate-left" : "fa-dice-d20",
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const el = this.element;

    // Edge/bane/skill selects
    for (const sel of el.querySelectorAll("[data-roll-option]")) {
      sel.addEventListener("change", (e) => {
        const actorId = e.target.dataset.actorId;
        const option = e.target.dataset.rollOption;
        if (!actorId || !option) return;

        const opts = this.#rollOptions.get(actorId) ?? { edges: 0, banes: 0, skill: "" };
        if (option === "skill") {
          opts.skill = e.target.value || "";
        } else {
          opts[option] = parseInt(e.target.value) || 0;
        }
        this.#rollOptions.set(actorId, opts);
      });
    }

    for (const button of el.querySelectorAll("[data-roll-preview]")) {
      button.addEventListener("mouseenter", () => this.#setRollPreview(button.dataset.rollPreview, true));
      button.addEventListener("mouseleave", () => this.#setRollPreview(button.dataset.rollPreview, false));
      button.addEventListener("focus", () => this.#setRollPreview(button.dataset.rollPreview, true));
      button.addEventListener("blur", () => this.#setRollPreview(button.dataset.rollPreview, false));
    }
  }

  #setRollPreview(target, active) {
    if (!target) return;
    for (const row of this.element.querySelectorAll("[data-contributor-row]")) {
      const willRoll = row.dataset.alreadyRolled !== "1"
        && (target === "all" || (target === "followers" && row.dataset.isFollower === "1"));
      row.querySelector(".dshideout-progress-portrait")?.classList.toggle("dshideout-roll-preview-highlight", active && willRoll);
    }
  }

  /* -------------------------------------------------- */
  /*  Rolling                                           */
  /* -------------------------------------------------- */

  static async #onRollAll(event, target) {
    // Prevent double-clicks from triggering multiple roll sequences.
    if (target.disabled) return;
    target.disabled = true;
    const originalHTML = target.innerHTML;
    target.innerHTML = `<i class="fas fa-cog fa-spin"></i> ${game.i18n.localize("DSHIDEOUT.ProgressProjects.RollInProgress")}`;

    try {
      await ProgressProjectsDialog.#runRollAll.call(this);
    } finally {
      // Restore in case an error occurs before the dialog closes.
      if (!this.closing && this.rendered) {
        target.disabled = false;
        target.innerHTML = originalHTML;
      }
    }
  }

  static async #onRollFollowers(event, target) {
    if (target.disabled) return;
    target.disabled = true;
    const originalHTML = target.innerHTML;
    target.innerHTML = `<i class="fas fa-cog fa-spin"></i> ${game.i18n.localize("DSHIDEOUT.ProgressProjects.RollInProgress")}`;

    try {
      await ProgressProjectsDialog.#runRollFollowers.call(this);
    } finally {
      if (!this.closing && this.rendered) {
        target.disabled = false;
        target.innerHTML = originalHTML;
      }
    }
  }

  static async #runRollFollowers() {
    const rowConfigs = ProgressProjectsDialog.#collectRollConfigs.call(this, { followersOnly: true });
    if (!rowConfigs.length) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.ProgressProjects.NoFollowerRolls"));
      return;
    }

    await this.close();

    await executeRollPipeline(rowConfigs, {
      headerOverride: game.i18n.localize("DSHIDEOUT.ProgressProjects.FollowerChatHeader"),
    });

    for (const cfg of rowConfigs) {
      await markIndividualRoll(cfg.project.id, cfg.actor.id);
    }
  }

  static async #runRollAll() {
    const projects = getProjects().filter(p => !p.completed && p.contributorIds.length > 0);
    if (!projects.length) return;

    const rowConfigs = ProgressProjectsDialog.#collectRollConfigs.call(this);

    // No remaining rolls = "Reset Project Rolls" mode: still resolve events,
    // then clear the individual-roll state.
    const rollsRemaining = rowConfigs.length > 0;

    // Build the set of projects whose contributors are present in this run
    // so we can resolve their events. When all rolls were done individually
    // (rollsRemaining=false), use every project that has individual rolls.
    let projectsInRun;
    if (rollsRemaining) {
      projectsInRun = [...new Map(rowConfigs.map(c => [c.project.id, c.project])).values()];
    } else {
      projectsInRun = projects.filter(p => (p.individuallyRolledIds ?? []).length > 0);
    }

    if (!rollsRemaining && !projectsInRun.length) return;

    // ── Project events (pre-roll resolution) ──────────────────────────────
    const eventQueue = []; // { project, event, timing, trigger }
    for (const project of projectsInRun) {
      const trigger = await evaluateProjectEventTrigger(project);
      if (!trigger) continue;
      const tableUuid = project.eventTableUuid;
      if (!tableUuid) {
        ui.notifications.warn(game.i18n.format("DSHIDEOUT.Events.NoTableConfigured", { project: project.name }));
        continue;
      }
      const event = await rollEventTable(tableUuid);
      if (!event) {
        ui.notifications.warn(game.i18n.format("DSHIDEOUT.Events.RollFailed", { project: project.name }));
        continue;
      }
      eventQueue.push({ project, event, timing: event.timing, trigger });
    }

    const beforeEvents = eventQueue.filter(e => e.timing === "before");
    const afterEvents  = eventQueue.filter(e => e.timing === "after");

    // ── Phase 1: post all "before" events ─────────────────────────────────
    for (const ev of beforeEvents) {
      const displayName = ev.project.additionalDetail
        ? `${ev.project.name} (${ev.project.additionalDetail})`
        : ev.project.name;
      await postEventChatMessage({
        project: ev.project,
        event: ev.event,
        privateToGM: ev.project.postEventsPrivate !== false,
        displayName,
      });
    }

    // Close the dialog before posting Proceed button so the GM can see it.
    await this.close();

    // ── Phase 2: gate behind Proceed button if any "before" ───────────────
    if (beforeEvents.length && rollsRemaining) {
      const runId = foundry.utils.randomID();
      const proceed = new Promise((resolve) => {
        ProgressProjectsDialog._pendingProceeds.set(runId, resolve);
      });
      await postProceedButtonMessage(runId);
      await proceed;  // resumes when GM clicks the button
    }

    // ── Phase 3: do the project rolls + breakthrough chain ────────────────
    if (rollsRemaining) {
      await executeRollPipeline(rowConfigs);
    }

    // ── Phase 4: mark milestones as triggered ─────────────────────────────
    for (const ev of eventQueue) {
      if (ev.trigger.reason === "milestone" && ev.trigger.fraction != null) {
        const fresh = getProjects().find(p => p.id === ev.project.id);
        if (!fresh) continue;
        const list = Array.from(new Set([...(fresh.eventsTriggeredMilestones ?? []), ev.trigger.fraction]));
        await updateProject(ev.project.id, { eventsTriggeredMilestones: list });
      }
    }

    // ── Phase 5: post all "after" events ──────────────────────────────────
    for (const ev of afterEvents) {
      const displayName = ev.project.additionalDetail
        ? `${ev.project.name} (${ev.project.additionalDetail})`
        : ev.project.name;
      await postEventChatMessage({
        project: ev.project,
        event: ev.event,
        privateToGM: ev.project.postEventsPrivate !== false,
        displayName,
      });
    }

    // ── Phase 6: clear individual-roll state for every project ────────────
    await clearAllIndividualRolls();

    // No explicit render needed — _saveProjects fires updateSetting which triggers
    // the debounced dshideout:refresh hook, keeping all clients in sync cleanly.
  }

  static #collectRollConfigs(options = {}) {
    const projects = getProjects().filter(p => !p.completed && p.contributorIds.length > 0);
    const rowConfigs = [];

    for (const row of this.element.querySelectorAll("[data-contributor-row]")) {
      if (row.dataset.alreadyRolled === "1") continue;
      if (options.followersOnly && row.dataset.isFollower !== "1") continue;

      const actorId = row.dataset.actorId;
      const projectId = row.dataset.projectId;
      if (!actorId || !projectId) continue;
      const actor = game.actors.get(actorId) ?? game.items.get(actorId);
      const project = projects.find(p => p.id === projectId);
      if (!actor || !project) continue;

      const opts = this.#rollOptions.get(actorId) ?? { edges: 0, banes: 0, skill: "" };
      const netBoon = (opts.edges ?? 0) - (opts.banes ?? 0);
      const edgeBonus = netBoon > 0 ? Math.min(4, 2 * netBoon) : 0;
      const skillBaseBonus = opts.skill ? 2 : 0;
      const cappedSum = Math.min(4, edgeBonus + skillBaseBonus);
      const skillBonus = Math.max(0, cappedSum - edgeBonus);
      const skillLabel = opts.skill ? (ds.CONFIG.skills?.list?.[opts.skill]?.label ?? opts.skill) : null;

      const chars = project.rollCharacteristic ?? [];
      const bestCharKey = chars.length
        ? chars.reduce((best, c) => {
            const val = actor.system.characteristics?.[c]?.value ?? 0;
            return val > (actor.system.characteristics?.[best]?.value ?? -Infinity) ? c : best;
          }, chars[0])
        : "might";
      const rollKey = CHARACTERISTIC_ROLL_KEYS[bestCharKey] ?? "M";
      const formula = `2d10 + @${rollKey}`;
      rowConfigs.push({
        actor,
        project,
        opts: { ...opts, bonuses: skillBonus, skillLabel },
        charKey: bestCharKey,
        formula,
        rollData: ProgressProjectsDialog.#getRollData(actor),
      });
    }

    return rowConfigs;
  }

  static #getRollData(actor) {
    return actor.getRollData?.() ?? {
      M: actor.system.characteristics?.might?.value ?? 0,
      A: actor.system.characteristics?.agility?.value ?? 0,
      R: actor.system.characteristics?.reason?.value ?? 0,
      I: actor.system.characteristics?.intuition?.value ?? 0,
      P: actor.system.characteristics?.presence?.value ?? 0,
    };
  }

  /**
   * Resolves a pending "Proceed with Project Rolls" run. Called from the
   * `renderChatMessage` hook when the GM clicks the chat button.
   * @param {string} runId
   * @returns {boolean} whether a pending run was resolved.
   */
  static resolvePendingProceed(runId) {
    const resolver = ProgressProjectsDialog._pendingProceeds.get(runId);
    if (!resolver) return false;
    ProgressProjectsDialog._pendingProceeds.delete(runId);
    resolver();
    return true;
  }

  /** @type {Map<string, () => void>} */
  static _pendingProceeds = new Map();
}