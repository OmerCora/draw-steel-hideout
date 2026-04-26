/**
 * Draw Steel â€“ Hideout
 * Progress Projects dialog: roll 2d10 + characteristic for each contributor,
 * apply breakthroughs on critical (19-20 total), update project points, post chat.
 */

import { MODULE_ID, FOLLOWER_TYPE, CHARACTERISTIC_ROLL_KEYS } from "../config.mjs";
import { getProjects, addProjectPoints, updateProject } from "../hideout/project-manager.mjs";
import { HideoutApp } from "../hideout/hideout-app.mjs";
import {
  evaluateProjectEventTrigger,
  rollEventTable,
  postEventChatMessage,
  postProceedButtonMessage,
} from "../hideout/project-events.mjs";

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
    position: { width: 600, height: "auto" },
    window: {
      title: "DSHIDEOUT.ProgressProjects.Title",
      resizable: true,
      icon: "fa-solid fa-dice",
    },
    actions: {
      rollAll: ProgressProjectsDialog.#onRollAll,
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

    for (const project of projects) {
      const groupRows = [];
      let rowIndex = 0;
      for (const actorId of project.contributorIds) {
        const actor = game.actors.get(actorId);
        if (!actor) continue;

        if (!this.#rollOptions.has(actorId)) {
          this.#rollOptions.set(actorId, { edges: 0, banes: 0 });
        }
        const opts = this.#rollOptions.get(actorId);

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

        groupRows.push({
          actorId,
          actorName: actor.name,
          actorImg: actor.img,
          projectId: project.id,
          charList,
          edges: opts.edges,
          banes: opts.banes,
          isEvenRow: rowIndex % 2 === 0,
        });
        rowIndex++;
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

    return {
      groups,
      hasRows: totalRows > 0,
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const el = this.element;

    // Edge/bane selects
    for (const sel of el.querySelectorAll("[data-roll-option]")) {
      sel.addEventListener("change", (e) => {
        const actorId = e.target.dataset.actorId;
        const option = e.target.dataset.rollOption;
        if (!actorId || !option) return;

        const opts = this.#rollOptions.get(actorId) ?? { edges: 0, banes: 0 };
        opts[option] = parseInt(e.target.value) || 0;
        this.#rollOptions.set(actorId, opts);
      });
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

  static async #runRollAll() {
    const projects = getProjects().filter(p => !p.completed && p.contributorIds.length > 0);
    if (!projects.length) return;

    const el = this.element;
    const rows = el.querySelectorAll("[data-contributor-row]");
    const rowConfigs = [];

    for (const row of rows) {
      const actorId = row.dataset.actorId;
      const projectId = row.dataset.projectId;
      if (!actorId || !projectId) continue;
      const actor = game.actors.get(actorId);
      const project = projects.find(p => p.id === projectId);
      if (!actor || !project) continue;
      const opts = this.#rollOptions.get(actorId) ?? { edges: 0, banes: 0 };
      // Pick the highest-value applicable characteristic for this actor,
      // matching the logic used in _prepareContext for display.
      const chars = project.rollCharacteristic ?? [];
      const bestCharKey = chars.length
        ? chars.reduce((best, c) => {
            const val = actor.system.characteristics?.[c]?.value ?? 0;
            return val > (actor.system.characteristics?.[best]?.value ?? -Infinity) ? c : best;
          }, chars[0])
        : "might";
      const rollKey = CHARACTERISTIC_ROLL_KEYS[bestCharKey] ?? "M";
      const formula = `2d10 + @${rollKey}`;
      const rollData = actor.getRollData?.() ?? {};
      rowConfigs.push({ actor, project, opts, charKey: bestCharKey, formula, rollData });
    }

    if (!rowConfigs.length) return;

    // ── Project events (pre-roll resolution) ──────────────────────────────
    // Group projects involved in this run, evaluate per-project triggers,
    // roll their event tables, and split into before/after the project rolls.
    const projectsInRun = [...new Map(rowConfigs.map(c => [c.project.id, c.project])).values()];
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
    if (beforeEvents.length) {
      const runId = foundry.utils.randomID();
      const proceed = new Promise((resolve) => {
        ProgressProjectsDialog._pendingProceeds.set(runId, resolve);
      });
      await postProceedButtonMessage(runId);
      await proceed;  // resumes when GM clicks the button
    }

    // ── Phase 3: do the project rolls + breakthrough chain ────────────────
    await ProgressProjectsDialog.#executeRollPipeline(rowConfigs);

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

    // No explicit render needed — _saveProjects fires updateSetting which triggers
    // the debounced dshideout:refresh hook, keeping all clients in sync cleanly.
  }

  /**
   * Execute the main roll batch + breakthrough chain. Extracted so it can
   * be deferred behind the "Proceed with Project Rolls" button.
   * @param {object[]} rowConfigs
   */
  static async #executeRollPipeline(rowConfigs) {
    const mainBatch = await ProgressProjectsDialog.#rollBatch(rowConfigs);
    if (game.dice3d) {
      await Promise.all(mainBatch.map(r => game.dice3d.showForRoll(r.roll, game.user, true)));
    }
    await ProgressProjectsDialog.#applyAndPost(mainBatch, 0);

    // Breakthrough chain: each natural 19-20 grants another roll, posted as
    // a separate chat message and points update.
    let prevBatch = mainBatch;
    for (let depth = 1; depth <= 10; depth++) {
      const breakthroughConfigs = prevBatch
        .filter(r => r.isNaturalBreakthrough)
        .map(r => r.cfg);
      if (!breakthroughConfigs.length) break;

      const btBatch = await ProgressProjectsDialog.#rollBatch(breakthroughConfigs);
      if (game.dice3d) {
        await Promise.all(btBatch.map(r => game.dice3d.showForRoll(r.roll, game.user, true)));
      }
      await ProgressProjectsDialog.#applyAndPost(btBatch, depth);
      prevBatch = btBatch;
    }
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

  /**
   * Roll a batch of project rolls and return enriched result objects.
   * Each result carries its original `cfg` so it can seed a breakthrough chain.
   * @param {object[]} configs
   * @returns {Promise<object[]>}
   */
  static async #rollBatch(configs) {
    const ProjectRoll = ds.rolls.ProjectRoll;
    return (await Promise.all(configs.map(async cfg => {
      try {
        const roll = new ProjectRoll(cfg.formula, cfg.rollData, {
          edges: cfg.opts.edges,
          banes: cfg.opts.banes,
        });
        await roll.evaluate();
        // Natural breakthrough: sum of the active (kept) dice before the characteristic bonus.
        // With edges/banes, extra dice are rolled and the lowest/highest are dropped;
        // only `active: true` results count toward the natural total.
        const naturalTotal = (roll.dice[0]?.results ?? [])
          .filter(r => r.active)
          .reduce((sum, r) => sum + r.result, 0);
        return {
          cfg,
          actor: cfg.actor,
          project: cfg.project,
          roll,
          product: roll.product ?? Math.max(1, roll.total),
          naturalTotal,
          isNaturalBreakthrough: naturalTotal >= 19,
        };
      } catch (err) {
        console.error(`draw-steel-hideout | ProjectRoll failed for ${cfg.actor.name}:`, err);
        ui.notifications.error(`Roll failed for ${cfg.actor.name}`);
        return null;
      }
    }))).filter(Boolean);
  }

  /**
   * Apply project points from a result batch and post a chat message.
   * @param {object[]} results   Rolled results from #rollBatch
   * @param {number}   chainDepth  0 = main roll, 1+ = Nth breakthrough in chain
   */
  static async #applyAndPost(results, chainDepth) {
    const projectPoints = new Map();
    for (const r of results) {
      projectPoints.set(r.project.id, (projectPoints.get(r.project.id) ?? 0) + r.product);
    }
    const updatedProjects = {};
    for (const [projectId, points] of projectPoints) {
      updatedProjects[projectId] = await addProjectPoints(projectId, points);
    }
    await ProgressProjectsDialog.#postChatMessage(results, updatedProjects, chainDepth);
  }

  static async #postChatMessage(results, updatedProjects, chainDepth) {
    const isBreakthrough = chainDepth > 0;
    const header = isBreakthrough
      ? `${game.i18n.localize("DSHIDEOUT.ProgressProjects.BreakthroughHeader")}${chainDepth > 1 ? ` (&times;${chainDepth})` : ""}`
      : game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatHeader");

    let content = `<div class="dshideout-progress-chat">`;
    content += `<h3>${header}</h3>`;
    content += `<table class="dshideout-progress-table"><thead><tr>
      <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatActor")}</th>
      <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatProject")}</th>
      <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatRoll")}</th>
      <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatProduct")}</th>
    </tr></thead><tbody>`;

    for (const r of results) {
      // Dice breakdown: show natural sum + modifier separately (e.g. "13-1" or "16+6")
      const diceSum = (r.roll.dice[0]?.results ?? [])
        .filter(res => res.active)
        .reduce((sum, res) => sum + res.result, 0);
      const modifier = r.roll.total - diceSum;
      const rollDisplay = modifier > 0
        ? `${diceSum}+${modifier}`
        : modifier < 0
          ? `${diceSum}${modifier}`
          : `${diceSum}`;

      const breakthroughBadge = r.isNaturalBreakthrough
        ? ` <span class="dshideout-breakthrough-badge" title="${game.i18n.localize("DSHIDEOUT.ProgressProjects.BreakthroughTooltip")}">&#x26a1;</span>`
        : "";
      content += `<tr>
        <td><img src="${r.actor.img}" class="dshideout-chat-portrait" />${foundry.utils.escapeHTML(r.actor.name)}</td>
        <td>${foundry.utils.escapeHTML(r.project.name)}</td>
        <td>${rollDisplay}${breakthroughBadge}</td>
        <td><strong>+${r.product}</strong></td>
      </tr>`;
    }

    content += `</tbody></table><div class="dshideout-project-summary">`;
    for (const [, result] of Object.entries(updatedProjects)) {
      const updated = result?.project;
      if (!updated) continue;
      const pct = updated.goal ? Math.min(100, Math.round((updated.points / updated.goal) * 100)) : 0;
      const progressText = updated.goal ? `${updated.points}/${updated.goal}` : `${updated.points}`;
      const completedText = updated.completed
        ? ` &#x2713; ${game.i18n.localize("DSHIDEOUT.ProgressProjects.Completed")}`
        : "";
      content += `<p><strong>${foundry.utils.escapeHTML(updated.name)}</strong>: ${progressText}${updated.goal ? ` (${pct}%)` : ""}${completedText}</p>`;
    }
    content += `</div></div>`;

    const ChatMessage = getDocumentClass("ChatMessage");
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker(),
      flags: { core: { canPopout: true } },
    });
  }
}