"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planNewWorkPrompt = exports.canHoldPrompt = exports.planPromptDuringHandoff = exports.carriesExtras = exports.senderLabel = exports.noteOrigin = exports.isUnattendedOrigin = exports.isComposerOrigin = exports.isPersonOrigin = void 0;
var signals_1 = require("./signals");
var PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger']);
var isPersonOrigin = function (kind) { return PERSON_ORIGINS.has(kind); };
exports.isPersonOrigin = isPersonOrigin;
// Only the composer is typed at this terminal; the other person origins have a sender who is somewhere else.
var isComposerOrigin = function (kind) { return kind === 'composer'; };
exports.isComposerOrigin = isComposerOrigin;
var isUnattendedOrigin = function (kind) { return kind === 'scheduled-trigger'; };
exports.isUnattendedOrigin = isUnattendedOrigin;
// The origin a handoff note goes out under when no held prompt rides with it: the handoff's own sender.
var noteOrigin = function (isUnattended) { return (isUnattended ? 'scheduled-trigger' : 'composer'); };
exports.noteOrigin = noteOrigin;
var SENDER_LABELS = new Map([
    ['composer', 'this terminal'],
    ['bridge', 'the bridge'],
    ['sdk', 'an SDK client'],
    ['scheduled-trigger', 'a scheduled task'],
]);
// Who sent a prompt, as a reader would say it. Only the person origins are named; any other origin never reaches a message.
var senderLabel = function (kind) { var _a; return (_a = SENDER_LABELS.get(kind)) !== null && _a !== void 0 ? _a : 'a sender outside this terminal'; };
exports.senderLabel = senderLabel;
// A held prompt comes back as text alone, so one that carries an attachment or context can't be held.
var carriesExtras = function (prompt) { var _a, _b, _c, _d; return ((_b = (_a = prompt.attachments) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0 || ((_d = (_c = prompt.context) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0; };
exports.carriesExtras = carriesExtras;
var planPromptDuringHandoff = function (_a) {
    var isCarried = _a.isCarried, isHolding = _a.isHolding, hasExtras = _a.hasExtras;
    if (isCarried)
        return 'drop-repeat';
    if (!isHolding)
        return 'proceed';
    return hasExtras ? 'refuse' : 'hold';
};
exports.planPromptDuringHandoff = planPromptDuringHandoff;
var canHoldPrompt = function (input) {
    return input.isNewWork && !input.hasPendingAction && !input.hasTurnId && !input.hasExtras;
};
exports.canHoldPrompt = canHoldPrompt;
var planNewWorkPrompt = function (input) {
    var signal = (0, signals_1.classify)({
        contextTokens: input.contextTokens,
        threshold: input.threshold,
        isStoppingPoint: true,
        isBackgroundBusy: input.isBackgroundBusy,
    });
    var response = (0, signals_1.respond)({
        mode: input.mode,
        signal: signal,
        stoppingPoint: 'new-work',
        isBackgroundBusy: input.isBackgroundBusy,
        isUnattended: input.isUnattended,
    });
    if (response.kind === 'handoff')
        return { signal: signal, action: 'handoff' };
    // Only a prompt typed at this terminal is held for the band: the sender of any other is somewhere else, and a refill
    // would put their prompt in the box of the person who is here. The turn it starts can still raise the band.
    if (response.kind === 'advise' && response.holdsPrompt && input.isFromComposer)
        return { signal: signal, action: 'hold' };
    return { signal: signal, action: 'none' };
};
exports.planNewWorkPrompt = planNewWorkPrompt;
