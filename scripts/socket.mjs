/**
 * Draw Steel – Hideout
 * Socket relay: lets non-GM clients write world-scoped settings via the GM.
 *
 * Architecture:
 *   - GMs write directly via `game.settings.set`.
 *   - Players emit a socket request; every active GM performs the write.
 *     (Multiple GMs writing the same value is idempotent.)
 *   - When the world setting is written, Foundry broadcasts the new value
 *     to every client and fires the `updateSetting` hook on every client,
 *     which we wire to `dshideout:refresh` in module.mjs.
 *   - As a robustness backup, the GM also emits an explicit
 *     `refreshHideout` socket message after writing, in case the
 *     `updateSetting` hook does not fire on a remote client.
 */

import { MODULE_ID, SETTINGS } from "./config.mjs";

const SOCKET_NAME = `module.${MODULE_ID}`;
const PROJECT_MUTATION_TIMEOUT_MS = 15000;

const pendingProjectMutations = new Map();
let projectMutationQueue = Promise.resolve();

/** All world-setting keys this module owns (used by the updateSetting hook). */
export const HIDEOUT_SETTING_KEYS = new Set([
  SETTINGS.PROJECTS,
  SETTINGS.STASH,
  SETTINGS.FOLLOWERS,
  SETTINGS.ITEM_FOLLOWERS,
  SETTINGS.ARCHIVES,
  SETTINGS.MINIMUM_ROLE,
  SETTINGS.MINIMUM_GM_ROLE,
  SETTINGS.DEFAULT_PROJECT_SETTINGS,
]);

// ── Permission helper ─────────────────────────────────────────────────────────

/**
 * Returns true if the current user meets the minimum role required to use
 * the Hideout's write operations.
 * @returns {boolean}
 */
export function hasHideoutPermission() {
  const required = game.settings.get(MODULE_ID, SETTINGS.MINIMUM_ROLE);
  return game.user.role >= required;
}

/**
 * Returns true if the current user meets the minimum role required to see
 * GM-only views and controls (project delete, +/- in stash & archives,
 * footer action buttons, etc.). Defaults to GAMEMASTER which preserves the
 * historical isGM-only behaviour.
 * @returns {boolean}
 */
export function hasGMPermission() {
  const required = game.settings.get(MODULE_ID, SETTINGS.MINIMUM_GM_ROLE);
  return game.user.role >= required;
}

// ── Socket setup ──────────────────────────────────────────────────────────────

/**
 * Register the socket listener. Call once from the `ready` hook on every
 * client. Each client both:
 *   - listens for incoming relay requests (only GMs act on them)
 *   - listens for explicit refresh broadcasts (everyone reacts)
 */
export function registerSocket() {
  game.socket.on(SOCKET_NAME, async (data) => {
    // Log EVERY incoming message so we can prove the socket is open on this client.
    console.log(`%c${MODULE_ID} | socket recv`, "color:#7af", data);

    if (!data || typeof data !== "object") return;

    if (data.action === "projectMutationResult") {
      if (data.targetUserId !== game.user.id) return;
      const pending = pendingProjectMutations.get(data.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeoutId);
      pendingProjectMutations.delete(data.requestId);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error ?? "Project mutation failed"));
      return;
    }

    // Explicit refresh broadcast — any client (including the originating
    // GM) re-renders by firing the local refresh hook.
    if (data.action === "refreshHideout") {
      Hooks.callAll("dshideout:refresh");
      return;
    }

    if (data.action === "mutateProjects") {
      if (!game.user.isGM || !_isPrimaryGM()) return;
      projectMutationQueue = projectMutationQueue
        .then(() => _handleProjectMutation(data))
        .catch(err => console.error(`${MODULE_ID} | Project mutation queue failed:`, err));
      return;
    }

    // Relay write — only GMs perform the actual setting write.
    if (data.action === "updateSetting") {
      if (!game.user.isGM) return;
      console.log(`%c${MODULE_ID} | GM relaying write for "${data.key}" from user ${data.fromUserId ?? "?"}`, "color:#7f7;font-weight:bold");
      try {
        await game.settings.set(data.moduleId, data.key, data.value);
        // Backup broadcast in case `updateSetting` hook does not fire on
        // remote clients (e.g. older Foundry builds, race conditions).
        game.socket.emit(SOCKET_NAME, { action: "refreshHideout" });
        // Also refresh locally — the GM is also a client.
        Hooks.callAll("dshideout:refresh");
        console.log(`%c${MODULE_ID} | GM write complete for "${data.key}"`, "color:#7f7");
      } catch (err) {
        console.error(`${MODULE_ID} | Socket relay write failed for "${data.key}":`, err);
      }
    }
  });

  console.log(
    `%c${MODULE_ID} | Socket listener REGISTERED v2 on "${SOCKET_NAME}" — user="${game.user.name}", isGM=${game.user.isGM}`,
    "color:#fc4;font-weight:bold;font-size:1.05em"
  );
}

// ── Relay helper ──────────────────────────────────────────────────────────────

/**
 * Write a world-scoped setting from any user.
 *
 * - GMs write directly. Foundry broadcasts the new value to all clients.
 * - Players emit a relay request. Every active GM performs the write
 *   (idempotent — same value), and Foundry then broadcasts the new value
 *   to every client (including the originating player). The GM also
 *   emits an explicit `refreshHideout` socket as a backup.
 *
 * This call returns immediately for players (no ack waiting). The UI will
 * refresh once the GM's write propagates back via `updateSetting` and/or
 * `refreshHideout`.
 *
 * @param {string} key    Setting key (from SETTINGS)
 * @param {string} value  Serialised value (JSON string)
 * @returns {Promise<void>}
 */
export async function saveWorldSetting(key, value) {
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, key, value);
    // Backup broadcast — ensures every client refreshes even if a remote
    // client's `updateSetting` hook doesn't fire for whatever reason.
    game.socket.emit(SOCKET_NAME, { action: "refreshHideout" });
    return;
  }

  // Non-GM: relay to the GM(s). Fire-and-forget.
  console.log(`${MODULE_ID} | Player relay emit for "${key}" (user="${game.user.name}")`);
  game.socket.emit(SOCKET_NAME, {
    action: "updateSetting",
    moduleId: MODULE_ID,
    key,
    value,
    fromUserId: game.user.id,
  });
}

/**
 * Request an atomic mutation of the persisted project list from a non-GM client.
 * The primary active GM serializes these requests so each mutation reads the
 * freshest project setting before saving.
 * @param {object} mutation
 * @returns {Promise<any>}
 */
export async function mutateProjectsSetting(mutation) {
  if (game.user.isGM) throw new Error("mutateProjectsSetting is only for non-GM relay requests");
  const hasActiveGM = game.users.some(u => u.isGM && u.active);
  if (!hasActiveGM) throw new Error("No active GM is available to update hideout projects");

  const requestId = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingProjectMutations.delete(requestId);
      reject(new Error("Timed out waiting for GM project mutation relay"));
    }, PROJECT_MUTATION_TIMEOUT_MS);
    pendingProjectMutations.set(requestId, { resolve, reject, timeoutId });
    game.socket.emit(SOCKET_NAME, {
      action: "mutateProjects",
      requestId,
      mutation,
      fromUserId: game.user.id,
    });
  });
}

function _isPrimaryGM() {
  const activeGMs = game.users
    .filter(u => u.isGM && u.active)
    .sort((a, b) => a.id.localeCompare(b.id));
  return activeGMs[0]?.id === game.user.id;
}

async function _handleProjectMutation(data) {
  try {
    const projects = _loadProjectsSetting();
    const { changed, result } = _applyProjectMutation(projects, data.mutation);
    if (changed) {
      await game.settings.set(MODULE_ID, SETTINGS.PROJECTS, JSON.stringify(projects));
      game.socket.emit(SOCKET_NAME, { action: "refreshHideout" });
      Hooks.callAll("dshideout:refresh");
    }
    _emitProjectMutationResult(data, true, result);
  } catch (err) {
    console.error(`${MODULE_ID} | Project mutation failed:`, err);
    _emitProjectMutationResult(data, false, null, err.message ?? String(err));
  }
}

function _emitProjectMutationResult(data, ok, result, error = null) {
  game.socket.emit(SOCKET_NAME, {
    action: "projectMutationResult",
    requestId: data.requestId,
    targetUserId: data.fromUserId,
    ok,
    result,
    error,
  });
}

function _loadProjectsSetting() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTINGS.PROJECTS);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

function _applyProjectMutation(projects, mutation) {
  switch (mutation?.type) {
    case "addProjectPoints":
      return _applyAddProjectPoints(projects, mutation);
    case "updateProject":
      return _applyUpdateProject(projects, mutation);
    case "markIndividualRoll":
      return _applyMarkIndividualRoll(projects, mutation);
    case "clearAllIndividualRolls":
      return _applyClearAllIndividualRolls(projects);
    case "unmarkIndividualRoll":
      return _applyUnmarkIndividualRoll(projects, mutation);
    default:
      throw new Error(`Unknown project mutation type: ${mutation?.type ?? "<missing>"}`);
  }
}

function _applyAddProjectPoints(projects, mutation) {
  const project = projects.find(p => p.id === mutation.projectId);
  if (!project) return { changed: false, result: null };

  const points = Number(mutation.points) || 0;
  const wasCompleted = project.completed;
  project.points = (project.points ?? 0) + points;

  const justCompleted = !wasCompleted && !!project.goal && project.points >= project.goal;
  if (justCompleted) project.completed = true;

  return { changed: points !== 0 || justCompleted, result: { project: foundry.utils.deepClone(project), justCompleted } };
}

function _applyUpdateProject(projects, mutation) {
  const project = projects.find(p => p.id === mutation.projectId);
  if (!project) return { changed: false, result: null };
  foundry.utils.mergeObject(project, mutation.changes ?? {});
  return { changed: true, result: foundry.utils.deepClone(project) };
}

function _applyMarkIndividualRoll(projects, mutation) {
  const project = projects.find(p => p.id === mutation.projectId);
  if (!project) return { changed: false, result: null };

  let changed = false;
  if (!Array.isArray(project.individuallyRolledIds)) {
    project.individuallyRolledIds = [];
    changed = true;
  }
  if (!project.individuallyRolledIds.includes(mutation.actorId)) {
    project.individuallyRolledIds.push(mutation.actorId);
    changed = true;
  }
  return { changed, result: foundry.utils.deepClone(project.individuallyRolledIds) };
}

function _applyClearAllIndividualRolls(projects) {
  let changed = false;
  for (const project of projects) {
    if (project.individuallyRolledIds?.length) {
      project.individuallyRolledIds = [];
      changed = true;
    }
  }
  return { changed, result: null };
}

function _applyUnmarkIndividualRoll(projects, mutation) {
  const project = projects.find(p => p.id === mutation.projectId);
  if (!project || !Array.isArray(project.individuallyRolledIds)) return { changed: false, result: null };
  const idx = project.individuallyRolledIds.indexOf(mutation.actorId);
  if (idx === -1) return { changed: false, result: null };
  project.individuallyRolledIds.splice(idx, 1);
  return { changed: true, result: foundry.utils.deepClone(project.individuallyRolledIds) };
}
