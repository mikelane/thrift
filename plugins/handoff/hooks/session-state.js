"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteCacheReads = exports.claimPending = exports.releaseTurnEndWaiter = exports.waitForTurnEnd = exports.beginNoteWindow = exports.removeResubmittedPrompt = exports.queueResubmittedPrompt = exports.endMainTurn = exports.startMainTurn = exports.recordSessionEnd = exports.beginOwnClear = exports.beginBeforeClear = exports.endHandoff = exports.releaseCarriedGroup = exports.releaseCarried = exports.takeLateArrivalsOrEndSending = exports.beginSending = exports.takeHeldPrompts = exports.isCarriedByHandoff = exports.refusedPromptPlacement = exports.addHeldPrompt = exports.isHoldingForHandoff = exports.beginHandoffHold = exports.isGroupOfOrigin = exports.resetForNewSession = exports.createState = exports.preClearOutcome = void 0;
var assertNever = function (value) {
    throw new Error("unhandled value: ".concat(String(value)));
};
// A session end outranks busy work: the person's clear wins over busy by decision, and any other end abandons.
var preClearOutcome = function (sessionEnd, isBusy) {
    switch (sessionEnd) {
        case 'other':
            return 'abandon_session_ended';
        case 'cleared_by_person':
            return 'deliver_to_person_clear';
        case null:
            return isBusy ? 'abandon_busy' : 'clear';
        default:
            return assertNever(sessionEnd);
    }
};
exports.preClearOutcome = preClearOutcome;
// A hot reload calls this again: see the SAFETY note at the call in register.tsx for what it does to a handoff in flight.
var createState = function (settings) { return (__assign(__assign({}, settings), { mode: 'off', engineVersion: 'unknown', contextTokens: 0, cacheReadTokens: 0, seenRefs: new Set(), urlPrefixes: new Set(), backgroundTasks: new Set(), hasFinishedTask: false, isTurnUnattended: false, resubmittedPrompts: [], backoffFrom: null, pending: null, heldPrompt: null, handoffHold: { phase: 'idle' }, hasBand: false, isTurnRunning: false, isPressRunning: false, deferredPress: null, hasTurnAfterNote: false, turnEndWaiter: null, handoffStage: 'idle', sessionEndBeforeClear: null })); };
exports.createState = createState;
var resetForNewSession = function (state) {
    state.contextTokens = 0;
    state.cacheReadTokens = 0;
    state.seenRefs.clear();
    state.urlPrefixes.clear();
    state.backgroundTasks.clear();
    state.hasFinishedTask = false;
    state.isTurnUnattended = false;
    state.resubmittedPrompts = [];
    state.backoffFrom = null;
    state.heldPrompt = null;
    state.isTurnRunning = false;
    state.isPressRunning = false;
    state.deferredPress = null;
};
exports.resetForNewSession = resetForNewSession;
// The prompts a handoff holds and carries, and its stage, survive resetForNewSession: the clear happens in the middle of
// the handoff. The turn-end waiter is not released here: the handoff must resume after the session end hook returns.
var isGroupOfOrigin = function (group, isUnattended) { return group.isUnattended === isUnattended; };
exports.isGroupOfOrigin = isGroupOfOrigin;
// The prompt the handoff carries is the first held prompt, so it is delivered with its own origin's group.
var beginHandoffHold = function (state, carried) {
    state.handoffHold = {
        phase: 'holding',
        heldPrompts: carried === null ? [] : [carried],
        promptCarriedByHandoff: carried === null ? null : carried.text,
    };
};
exports.beginHandoffHold = beginHandoffHold;
var isHoldingForHandoff = function (state) {
    return state.handoffHold.phase === 'holding' || state.handoffHold.phase === 'sending';
};
exports.isHoldingForHandoff = isHoldingForHandoff;
// Returns how many prompts are held now, or 0 when no handoff is holding and nothing was added.
var addHeldPrompt = function (state, prompt) {
    var hold = state.handoffHold;
    if (hold.phase === 'holding') {
        hold.heldPrompts.push(prompt);
        return hold.heldPrompts.length;
    }
    if (hold.phase === 'sending') {
        hold.lateArrivals.push(prompt);
        return hold.lateArrivals.length;
    }
    return 0;
};
exports.addHeldPrompt = addHeldPrompt;
// A prompt refused while the held ones are being put back comes after them in the box, as a held late arrival does.
var refusedPromptPlacement = function (hold) { return (hold.phase === 'sending' ? 'after_draft' : 'before_draft'); };
exports.refusedPromptPlacement = refusedPromptPlacement;
var isCarriedByHandoff = function (state, text) {
    return state.handoffHold.phase !== 'idle' && state.handoffHold.promptCarriedByHandoff === text;
};
exports.isCarriedByHandoff = isCarriedByHandoff;
// Once taken, a prompt that arrives is no longer held, until beginSending holds again: a handoff that goes on to the fresh
// session calls it before any await, and one that failed leaves later prompts to the old session.
var takeHeldPrompts = function (state) {
    var hold = state.handoffHold;
    if (hold.phase !== 'holding')
        return [];
    state.handoffHold =
        hold.promptCarriedByHandoff === null
            ? { phase: 'idle' }
            : { phase: 'delivering', promptCarriedByHandoff: hold.promptCarriedByHandoff };
    return hold.heldPrompts;
};
exports.takeHeldPrompts = takeHeldPrompts;
// Called at the top of the delivery, with no await since the held prompts were taken, so no prompt slips through unheld
// between the two. Holding stays on until takeLateArrivalsOrEndSending finds nothing left.
var beginSending = function (state) {
    var hold = state.handoffHold;
    state.handoffHold = {
        phase: 'sending',
        promptCarriedByHandoff: hold.phase === 'idle' ? null : hold.promptCarriedByHandoff,
        lateArrivals: [],
    };
};
exports.beginSending = beginSending;
// Prompts that arrived while sending, oldest first. Finding none ends the sending in the same synchronous run, so a prompt
// cannot land between the empty check and the end of the hold and be left unsent.
var takeLateArrivalsOrEndSending = function (state) {
    var hold = state.handoffHold;
    if (hold.phase !== 'sending')
        return [];
    if (hold.lateArrivals.length === 0) {
        state.handoffHold = { phase: 'idle' };
        return [];
    }
    return hold.lateArrivals.splice(0);
};
exports.takeLateArrivalsOrEndSending = takeLateArrivalsOrEndSending;
// The carried prompt is no longer a repeat to drop once it has been handed back or sent: a later copy is a new prompt.
var releaseCarried = function (state) {
    var hold = state.handoffHold;
    if (hold.phase === 'delivering')
        state.handoffHold = { phase: 'idle' };
    if (hold.phase === 'sending')
        hold.promptCarriedByHandoff = null;
};
exports.releaseCarried = releaseCarried;
// The carried prompt travels in the group that shares the handoff's origin.
var releaseCarriedGroup = function (state, group, handoffIsUnattended) {
    if ((0, exports.isGroupOfOrigin)(group, handoffIsUnattended))
        (0, exports.releaseCarried)(state);
};
exports.releaseCarriedGroup = releaseCarriedGroup;
// Ends both the hold on prompts and the stage, so the session end after this point is no handoff's business.
var endHandoff = function (state) {
    state.handoffHold = { phase: 'idle' };
    state.handoffStage = 'idle';
};
exports.endHandoff = endHandoff;
var beginBeforeClear = function (state) {
    state.handoffStage = 'before_clear';
    state.sessionEndBeforeClear = null;
};
exports.beginBeforeClear = beginBeforeClear;
var beginOwnClear = function (state) {
    state.handoffStage = 'own_clear';
};
exports.beginOwnClear = beginOwnClear;
// Only an end that arrives before the handoff's own clear counts. A resume outranks a person's clear: it abandons.
var recordSessionEnd = function (state, reason) {
    if (state.handoffStage !== 'before_clear')
        return;
    if (state.sessionEndBeforeClear === 'other')
        return;
    state.sessionEndBeforeClear = reason === 'clear' ? 'cleared_by_person' : 'other';
};
exports.recordSessionEnd = recordSessionEnd;
// A turn in the session the person cleared to is not one the note missed, so it does not count. A turn that one of the
// plugin's own submissions started takes that prompt's origin from the queue below.
var startMainTurn = function (state, turnText) {
    state.isTurnRunning = true;
    var matchIndex = state.resubmittedPrompts.findIndex(function (prompt) { return turnText.includes(prompt.text); });
    var resubmittedPrompt = matchIndex === -1 ? undefined : state.resubmittedPrompts.splice(matchIndex, 1)[0];
    if (resubmittedPrompt !== undefined)
        state.isTurnUnattended = resubmittedPrompt.isUnattended;
    if (state.sessionEndBeforeClear === null)
        state.hasTurnAfterNote = true;
};
exports.startMainTurn = startMainTurn;
var endMainTurn = function (state) {
    state.isTurnRunning = false;
};
exports.endMainTurn = endMainTurn;
// The engine has no origin to give a prompt the plugin submits, and submit can resolve once the prompt is queued behind the
// running turn, before its own turn starts. So the origins of the plugin's own submissions wait here in submit order, and a turn start takes the first
// whose text the turn's text contains: turn.start gives the text, which may carry a frame around what was submitted, so the
// match is "contains", not "equals". A turn whose text matches none (a task notification, a peer's message) leaves the queue
// alone.
// SAFETY: a turn that merely contains a queued prompt's text, such as a task notification quoting it, would take its entry,
// and a short prompt makes that likelier. An entry stays until a turn takes it, so one whose text a hook beneath rewrote
// waits for such a turn. Either needs a turn quoting a resubmitted prompt, which is not a case worth a guard. The cost,
// outside off, is one turn end judged as the wrong kind of sender: a person asked where a scheduled turn would act, or a scheduled turn's
// rule applied to a person's turn, so a strong signal hands off without asking and a weak one shows no band.
// An empty text is not queued: every turn's text contains it, so it would take the first turn that starts.
var queueResubmittedPrompt = function (state, prompt) {
    if (prompt.text === '')
        return;
    state.resubmittedPrompts.push(prompt);
};
exports.queueResubmittedPrompt = queueResubmittedPrompt;
// A prompt that did not enter starts no turn, so its place in the queue goes.
var removeResubmittedPrompt = function (state, prompt) {
    var index = state.resubmittedPrompts.indexOf(prompt);
    if (index !== -1)
        state.resubmittedPrompts.splice(index, 1);
};
exports.removeResubmittedPrompt = removeResubmittedPrompt;
// The note's fork sees the conversation only up to here, so a turn already running now is missing from the note too.
var beginNoteWindow = function (state) {
    state.hasTurnAfterNote = state.isTurnRunning;
};
exports.beginNoteWindow = beginNoteWindow;
// Resolves when the turn-end waiter is released. The caller re-checks isTurnRunning after each wake-up.
// SAFETY: a single waiter slot is enough. claimPending(state, 'handoff') admits one handoff at a time, and only that
// handoff's loop waits, so a second waiter can never overwrite the first and leave it hanging.
var waitForTurnEnd = function (state) {
    return new Promise(function (resolve) {
        state.turnEndWaiter = resolve;
    });
};
exports.waitForTurnEnd = waitForTurnEnd;
var releaseTurnEndWaiter = function (state) {
    var waiter = state.turnEndWaiter;
    state.turnEndWaiter = null;
    waiter === null || waiter === void 0 ? void 0 : waiter();
};
exports.releaseTurnEndWaiter = releaseTurnEndWaiter;
var claimPending = function (state, kind) {
    if (state.pending !== null)
        return false;
    state.pending = kind;
    return true;
};
exports.claimPending = claimPending;
var noteCacheReads = function (state, cacheReadTokens) {
    state.cacheReadTokens = cacheReadTokens !== null && cacheReadTokens !== void 0 ? cacheReadTokens : 0;
};
exports.noteCacheReads = noteCacheReads;
