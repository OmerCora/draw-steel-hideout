/**
 * Draw Steel – Hideout
 * Project Event helpers: discovery of event RollTables, evaluation of event
 * triggers (d6, milestone, guaranteed), rolling event tables, and posting
 * the results to chat.
 *
 * Design notes:
 *   - Event mode "disabled" => never trigger.
 *   - "d6"        => roll 1d6 each time #onRollAll fires; on a 6 trigger.
 *   - "milestone" => trigger when the project has crossed a goal-fraction
 *                    milestone since the last roll. Fractions depend on goal
 *                    size (see EVENT_MILESTONES below). A milestone fires
 *                    only once per project; tracked via
 *                    `project.eventsTriggeredMilestones`.
 *   - "guaranteed"=> trigger every #onRollAll.
 *
 *   - The system compendium pack `draw-steel.tables` contains a folder
 *     "Project Events" with the per-project event tables and a generic
 *     "Crafting and Research Events" table. The dropdown also lists any
 *     world RollTable whose name contains "event".
 */

import { MODULE_ID } from "../config.mjs";

/** System compendium that holds the event tables. */
const SYSTEM_TABLES_PACK = "draw-steel.tables";

/** Default fallback table when nothing matches. */
export const DEFAULT_EVENT_TABLE_NAME = "Crafting and Research Events";

/** Map of project name → preferred event table name. */
const SPECIAL_TABLES = {
  // Hone Career Skills variants → shared event table
  "Hone Career Skills - Two Skills Career":   "Hone Career Skills Event",
  "Hone Career Skills - Three Skills Career": "Hone Career Skills Event",
  // Community Service
  "Community Service":                         "Community Service Events",
  // Fishing (also in EVENTS_OPTOUT_PROJECTS, but keep for table-assignment UI)
  "Fishing":                                   "Fishing Events",
  // Learn From a Master variants → shared event table
  "Learn From a Master - Acquire Ability":     "Learn From a Master Events",
  "Learn From a Master - Hone Ability":        "Learn From a Master Events",
  "Learn From a Master - Improve Control":     "Learn From a Master Events",
  // Other special projects
  "Spend Time With Loved Ones":               "Spend Time With Loved Ones Events",
  "Build or Repair Road":                     "Build or Repair Road Events",
};

/** Project names that are handled with custom rules; do NOT auto-trigger events. */
export const EVENTS_OPTOUT_PROJECTS = new Set(["Fishing"]);

/**
 * Milestone configuration. For each goal size, list the fractions of
 * progress at which an event fires. The event fires when a project's
 * current points/goal ratio is >= the fraction AND the fraction has not
 * yet been triggered for this project.
 */
const EVENT_MILESTONES = [
  { maxGoal: 30,    fractions: [] },
  { maxGoal: 200,   fractions: [0.5] },
  { maxGoal: 999,   fractions: [1 / 3, 2 / 3] },
  { maxGoal: Infinity, fractions: [0.25, 0.5, 0.75] },
];

/* -------------------------------------------------- */
/*  Table discovery                                   */
/* -------------------------------------------------- */

/**
 * Resolve a RollTable document by UUID. Returns null on failure.
 * @param {string|null} uuid
 * @returns {Promise<RollTable|null>}
 */
export async function getEventTable(uuid) {
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    if (doc?.documentName === "RollTable") return doc;
  } catch (err) {
    console.warn(`${MODULE_ID} | getEventTable failed for "${uuid}":`, err);
  }
  return null;
}

/**
 * Return all event RollTables suitable for the dropdown:
 *   - every world RollTable whose name contains "event"
 *   - every RollTable in the system tables pack whose name contains "event"
 *
 * Each entry is `{ uuid, name, source }` where `source` is "world" or "system".
 * @returns {Promise<{uuid: string, name: string, source: string}[]>}
 */
export async function listEventTables() {
  const out = [];

  // World tables
  for (const table of game.tables ?? []) {
    if (table.name?.toLowerCase().includes("event")) {
      out.push({ uuid: table.uuid, name: table.name, source: "world" });
    }
  }

  // System pack tables (use the index — much cheaper than getDocuments).
  const pack = game.packs.get(SYSTEM_TABLES_PACK);
  if (pack) {
    const index = await pack.getIndex({ fields: ["name"] });
    for (const entry of index) {
      if (entry.name?.toLowerCase().includes("event")) {
        out.push({
          uuid: `Compendium.${SYSTEM_TABLES_PACK}.RollTable.${entry._id}`,
          name: entry.name,
          source: "system",
        });
      }
    }
  }

  // De-duplicate by uuid and sort by name
  const seen = new Set();
  return out
    .filter(t => {
      if (seen.has(t.uuid)) return false;
      seen.add(t.uuid);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find the default event table UUID for a project, by name match.
 * Returns a special table for known projects, or the generic
 * "Crafting and Research Events" table, or null if neither exists.
 *
 * @param {string} projectName
 * @returns {Promise<string|null>}
 */
export async function findDefaultEventTableUuid(projectName) {
  const wantedSpecial = SPECIAL_TABLES[projectName];
  if (wantedSpecial) {
    // Search world tables first.
    const worldTable = game.tables.find(t => t.name === wantedSpecial);
    if (worldTable) return worldTable.uuid;
    // Search the system pack index directly — bypasses the "event" name filter
    // in listEventTables(), which would exclude variant tables like
    // "Hone Career Skills - Two Skills Career".
    const pack = game.packs.get(SYSTEM_TABLES_PACK);
    if (pack) {
      const index = await pack.getIndex({ fields: ["name"] });
      const entry = index.find(e => e.name === wantedSpecial);
      if (entry) return `Compendium.${SYSTEM_TABLES_PACK}.RollTable.${entry._id}`;
    }
  }
  // Fall back to the generic crafting/research events table.
  const all = await listEventTables();
  const fallback = all.find(t => t.name === DEFAULT_EVENT_TABLE_NAME);
  return fallback?.uuid ?? null;
}

/* -------------------------------------------------- */
/*  Trigger evaluation                                */
/* -------------------------------------------------- */

/**
 * Get the list of milestone fractions that apply to a project goal size.
 * @param {number|null} goal
 * @returns {number[]}
 */
function _milestoneFractionsForGoal(goal) {
  if (!goal || goal <= 0) return [];
  const tier = EVENT_MILESTONES.find(m => goal <= m.maxGoal);
  return tier ? tier.fractions : [];
}

/**
 * Determine whether an event should trigger for a project on this roll.
 * Returns either `null` (no event) or `{ reason, fraction? }`.
 *
 * For "milestone", `fraction` is the milestone that has been crossed and
 * should be marked as triggered after the event fires.
 *
 * @param {object} project
 * @returns {Promise<{reason: string, fraction?: number}|null>}
 */
export async function evaluateProjectEventTrigger(project) {
  if (!project) return null;
  if (EVENTS_OPTOUT_PROJECTS.has(project.name)) return null;
  if (project.completed) return null;

  const mode = project.eventsMode ?? "disabled";
  if (mode === "disabled") return null;

  if (mode === "guaranteed") return { reason: "guaranteed" };

  if (mode === "d6") {
    const roll = new Roll("1d6");
    await roll.evaluate();
    // Animate the d6 and WAIT for it to finish before proceeding —
    // showForRoll resolves only after the animation completes, whereas
    // ChatMessage.create with rolls triggers DSN non-blocking via hook.
    if (game.dice3d) {
      await game.dice3d.showForRoll(roll, game.user, true);
    }
    const triggered = roll.total === 6;
    const msgKey = triggered ? "DSHIDEOUT.Events.D6CheckTriggered" : "DSHIDEOUT.Events.D6CheckMissed";
    // Respect the project's postEventsPrivate setting for the d6 check message too.
    const whisper = project.postEventsPrivate !== false
      ? game.users.filter(u => u.isGM).map(u => u.id)
      : [];
    await ChatMessage.create({
      content: `<p>${game.i18n.format(msgKey, { project: project.name, result: roll.total })}</p>`,
      whisper,
    });
    return triggered ? { reason: "d6", roll } : null;
  }

  if (mode === "milestone") {
    const goal = project.goal ?? 0;
    const points = project.points ?? 0;
    if (!goal) return null;
    const ratio = points / goal;
    const triggered = new Set(project.eventsTriggeredMilestones ?? []);
    const fractions = _milestoneFractionsForGoal(goal);
    // Find the first un-triggered milestone the project has crossed.
    const crossed = fractions.find(f => ratio >= f && !triggered.has(f));
    if (crossed != null) return { reason: "milestone", fraction: crossed };
    return null;
  }

  return null;
}

/* -------------------------------------------------- */
/*  Rolling + chat                                    */
/* -------------------------------------------------- */

/**
 * Determine whether an event result is "Before the roll" or "After the roll".
 * Falls back to "after" when the prefix cannot be detected.
 *
 * @param {string} text
 * @returns {"before"|"after"}
 */
export function classifyEventTiming(text) {
  if (!text) return "after";
  // Strip HTML tags first (table results may contain enrichers / markup).
  const tmp = document.createElement("div");
  tmp.innerHTML = text;
  const stripped = tmp.textContent ?? "";
  const lower = stripped.trimStart().toLowerCase();
  if (lower.startsWith("before the roll")) return "before";
  if (lower.startsWith("after the roll")) return "after";
  return "after";
}

/**
 * Roll an event table. Returns `{ table, roll, results, text, timing }` or null on failure.
 *
 * Does NOT post the result to chat — caller controls that to coordinate
 * before/after timing and visibility.
 *
 * @param {string} tableUuid
 * @returns {Promise<{table: RollTable, roll: Roll, results: TableResult[], text: string, timing: "before"|"after"}|null>}
 */
export async function rollEventTable(tableUuid) {
  const table = await getEventTable(tableUuid);
  if (!table) return null;
  try {
    // Roll the formula manually instead of calling table.roll(), which internally
    // calls table.normalize() → update() — that throws on locked compendium tables.
    const formula = table.formula || "1d100";
    const roll = new Roll(formula);
    await roll.evaluate();
    const total = roll.total;

    // Match results by range (standard weighted table format).
    let matched = table.results.contents.filter(r => {
      const [lo, hi] = r.range ?? [];
      return lo != null && hi != null && total >= lo && total <= hi;
    });
    // Fallback: pick first result if nothing matched (e.g. table has no ranges).
    if (!matched.length && table.results.size > 0) {
      matched = [table.results.contents[0]];
    }

    const text = matched.map(r => r.description ?? r.text ?? r.name ?? "").join("\n");
    return { table, roll, results: matched, text, timing: classifyEventTiming(text) };
  } catch (err) {
    console.error(`${MODULE_ID} | rollEventTable failed for "${tableUuid}":`, err);
    return null;
  }
}

/**
 * Post an event-result chat message.
 *
 * @param {object} options
 * @param {object} options.project          The project the event belongs to.
 * @param {object} options.event            Output of rollEventTable.
 * @param {boolean} options.privateToGM     If true, message is whispered to GMs only.
 * @param {string} [options.displayName]    Project display name (with additionalDetail).
 */
export async function postEventChatMessage({ project, event, privateToGM, displayName }) {
  const name = displayName || project.name;
  const tableName = event.table.name;
  const resultHtml = event.text;

  const headerLabel = game.i18n.format("DSHIDEOUT.Events.EventForProject", { project: name });
  const tableLabel = game.i18n.format("DSHIDEOUT.Events.RolledFromTable", { table: tableName });

  const content = `
    <div class="dshideout-event-chat">
      <h3 class="dshideout-event-chat-header">
        <i class="fas fa-bolt"></i> ${headerLabel}
      </h3>
      <p class="dshideout-event-chat-table">${tableLabel}</p>
      <div class="dshideout-event-chat-result">${resultHtml}</div>
    </div>`;

  const data = {
    content,
    speaker: ChatMessage.getSpeaker(),
    flags: { [MODULE_ID]: { type: "projectEvent", projectId: project.id } },
  };
  if (privateToGM) {
    data.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  }
  await ChatMessage.create(data);

  // UI notification for the table
  ui.notifications.info(headerLabel);
}

/**
 * Post the "Proceed with Project Rolls" GM-only chat message that contains
 * the action button. The message carries a flag with the runId so the
 * receiving handler can resume the deferred roll batch.
 *
 * @param {string} runId
 */
export async function postProceedButtonMessage(runId) {
  const label = game.i18n.localize("DSHIDEOUT.Events.ProceedButton");
  const hint = game.i18n.localize("DSHIDEOUT.Events.ProceedHint");
  const content = `
    <div class="dshideout-event-proceed">
      <p>${hint}</p>
      <button type="button" class="dshideout-event-proceed-btn"
              data-action="dshideoutProceedProjectRolls"
              data-run-id="${runId}">
        <i class="fas fa-dice"></i> ${label}
      </button>
    </div>`;
  const whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  await ChatMessage.create({
    content,
    speaker: { alias: "Hideout" },
    whisper,
    flags: { [MODULE_ID]: { type: "projectEventProceed", runId } },
  });
}
