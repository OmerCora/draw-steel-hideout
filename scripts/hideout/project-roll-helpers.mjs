/**
 * Draw Steel – Hideout
 * Shared helpers for project roll batches: rolling, applying points,
 * posting chat messages. Used by both the Progress Projects dialog
 * (Roll All) and the Individual Project Roll dialog.
 */

import { addProjectPoints } from "./project-manager.mjs";

/**
 * Roll a batch of project rolls and return enriched result objects.
 * Each result carries its original `cfg` so it can seed a breakthrough chain.
 * @param {object[]} configs  Array of { actor, project, opts, charKey, formula, rollData }.
 * @returns {Promise<object[]>}
 */
export async function rollBatch(configs) {
  const ProjectRoll = ds.rolls.ProjectRoll;
  return (await Promise.all(configs.map(async cfg => {
    try {
      const roll = new ProjectRoll(cfg.formula, cfg.rollData, {
        edges: cfg.opts.edges,
        banes: cfg.opts.banes,
      });
      await roll.evaluate();
      // Natural breakthrough: sum of the active (kept) dice before the
      // characteristic bonus. With edges/banes, extra dice are rolled and
      // the lowest/highest are dropped; only `active: true` results count.
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
 * @param {object[]} results        Rolled results from rollBatch.
 * @param {number}   chainDepth     0 = main roll, 1+ = Nth breakthrough in chain.
 * @param {object}   [options]
 * @param {string}   [options.headerOverride]  Custom chat header (e.g. for individual roll).
 */
export async function applyAndPost(results, chainDepth, options = {}) {
  const projectPoints = new Map();
  for (const r of results) {
    projectPoints.set(r.project.id, (projectPoints.get(r.project.id) ?? 0) + r.product);
  }
  const updatedProjects = {};
  for (const [projectId, points] of projectPoints) {
    updatedProjects[projectId] = await addProjectPoints(projectId, points);
  }
  await postProjectRollChatMessage(results, updatedProjects, chainDepth, options);
}

/**
 * Post a chat message describing a batch of project rolls.
 * @param {object[]} results
 * @param {object} updatedProjects
 * @param {number} chainDepth
 * @param {object} [options]
 * @param {string} [options.headerOverride]
 */
export async function postProjectRollChatMessage(results, updatedProjects, chainDepth, options = {}) {
  const isBreakthrough = chainDepth > 0;
  let header;
  if (options.headerOverride) {
    header = options.headerOverride;
  } else {
    header = isBreakthrough
      ? `${game.i18n.localize("DSHIDEOUT.ProgressProjects.BreakthroughHeader")}${chainDepth > 1 ? ` (&times;${chainDepth})` : ""}`
      : game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatHeader");
  }

  let content = `<div class="dshideout-progress-chat">`;
  content += `<h3>${header}</h3>`;
  content += `<table class="dshideout-progress-table"><thead><tr>
    <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatActor")}</th>
    <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatProject")}</th>
    <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatRoll")}</th>
    <th>${game.i18n.localize("DSHIDEOUT.ProgressProjects.ChatProduct")}</th>
  </tr></thead><tbody>`;

  for (const r of results) {
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

/**
 * Execute a roll batch + breakthrough chain (up to depth 10), animating
 * each batch via Dice So Nice when available.
 * @param {object[]} rowConfigs  Initial configs to roll.
 * @param {object} [options]
 * @param {string} [options.headerOverride]  Custom chat header for the main batch.
 */
export async function executeRollPipeline(rowConfigs, options = {}) {
  const mainBatch = await rollBatch(rowConfigs);
  if (game.dice3d) {
    await Promise.all(mainBatch.map(r => game.dice3d.showForRoll(r.roll, game.user, true)));
  }
  await applyAndPost(mainBatch, 0, options);

  let prevBatch = mainBatch;
  for (let depth = 1; depth <= 10; depth++) {
    const breakthroughConfigs = prevBatch
      .filter(r => r.isNaturalBreakthrough)
      .map(r => r.cfg);
    if (!breakthroughConfigs.length) break;

    const btBatch = await rollBatch(breakthroughConfigs);
    if (game.dice3d) {
      await Promise.all(btBatch.map(r => game.dice3d.showForRoll(r.roll, game.user, true)));
    }
    await applyAndPost(btBatch, depth);
    prevBatch = btBatch;
  }
}
