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
exports.bandMessage = exports.isSameOffer = exports.isWriting = exports.statusText = exports.WAITING_STATUS = exports.WRITING_STATUS = exports.WAITING = exports.WRITING = exports.offerWithBusyState = exports.clearsSession = exports.bandControls = exports.bandHint = exports.BUTTON_LABELS = void 0;
var signals_1 = require("./signals");
exports.BUTTON_LABELS = {
    handoff: 'Hand off and clear',
    'handoff-send': 'Hand off and send it',
    'send-here': 'Send here',
    compact: 'Compact',
    'not-now': 'Not now',
};
// Actions take letters, which work only once the band holds focus; a bare digit in an empty prompt presses a
// band button, so the digit is reserved for the dismiss and cannot be hit by answering Claude's numbered questions.
var HOTKEYS = {
    handoff: 'h',
    'handoff-send': 'h',
    'send-here': 's',
    compact: 'c',
    'not-now': '0',
};
var ACT_MODE_HINT = 'Set handoffMode to act in /config to skip asking.';
var hintFor = function (_a) {
    var signal = _a.signal, hasHeldPrompt = _a.hasHeldPrompt, isBusy = _a.isBusy;
    var handoff = HOTKEYS.handoff, sendHere = HOTKEYS["send-here"], dismiss = HOTKEYS["not-now"];
    if (hasHeldPrompt) {
        return isBusy
            ? 'ctrl+x Tab, then Enter to send it here.'
            : "ctrl+x Tab, then Enter to hand off and send it, or ".concat(sendHere, " to send it here.");
    }
    if (isBusy)
        return "ctrl+x Tab, then Enter to compact. ".concat(dismiss, " to dismiss.");
    if (signal === 'strong')
        return "ctrl+x Tab, then Enter to hand off. ".concat(dismiss, " to dismiss.");
    return "ctrl+x Tab, then Enter to compact or ".concat(handoff, " to hand off. ").concat(dismiss, " to dismiss.");
};
var bandHint = function (offer) { return "".concat(hintFor(offer), " ").concat(ACT_MODE_HINT); };
exports.bandHint = bandHint;
// The recommended button is the first action, so focus lands on the first button of every band.
var bandControls = function (buttons) {
    var recommended = buttons.find(function (button) { return button !== 'not-now'; });
    return buttons.map(function (button) { return ({
        button: button,
        hotkey: HOTKEYS[button],
        isPrimary: button === recommended,
        isDismiss: button === 'not-now',
    }); });
};
exports.bandControls = bandControls;
var CLEARS_SESSION = {
    handoff: true,
    'handoff-send': true,
    'send-here': false,
    compact: false,
    'not-now': false,
};
var clearsSession = function (button) { return CLEARS_SESSION[button]; };
exports.clearsSession = clearsSession;
// classify() gives a weak signal whenever work is busy; a held prompt keeps its own signal.
var offerWithBusyState = function (offer, contextTokens, isBusy) { return (__assign(__assign({}, offer), { contextTokens: contextTokens, isBusy: isBusy, signal: isBusy && !offer.hasHeldPrompt ? 'weak' : offer.signal })); };
exports.offerWithBusyState = offerWithBusyState;
exports.WRITING = { isWriting: true, stage: 'note' };
exports.WAITING = { isWriting: true, stage: 'wait' };
exports.WRITING_STATUS = 'Writing a handoff note — this takes a few seconds…';
exports.WAITING_STATUS = 'Handoff note written. The handoff continues when the current turn ends. Your prompts stay held.';
var statusText = function (_a) {
    var stage = _a.stage;
    return (stage === 'wait' ? exports.WAITING_STATUS : exports.WRITING_STATUS);
};
exports.statusText = statusText;
var isWriting = function (band) { return 'isWriting' in band; };
exports.isWriting = isWriting;
var isSameOffer = function (a, b) {
    return !(0, exports.isWriting)(a) &&
        !(0, exports.isWriting)(b) &&
        a.signal === b.signal && a.contextTokens === b.contextTokens && a.hasHeldPrompt === b.hasHeldPrompt && a.isBusy === b.isBusy;
};
exports.isSameOffer = isSameOffer;
var question = function (_a) {
    var signal = _a.signal, hasHeldPrompt = _a.hasHeldPrompt, isBusy = _a.isBusy;
    if (hasHeldPrompt && isBusy)
        return 'A handoff would orphan that work, so send it here?';
    if (hasHeldPrompt)
        return 'Hand off and send it in a fresh session, or send it here?';
    if (signal === 'strong')
        return 'Hand off to a fresh session now?';
    if (isBusy)
        return 'A handoff would orphan that work, so compact instead?';
    return 'Compact, or hand off to a fresh session?';
};
var situation = function (_a) {
    var signal = _a.signal, contextTokens = _a.contextTokens, hasHeldPrompt = _a.hasHeldPrompt, isBusy = _a.isBusy;
    var context = "Context is ".concat((0, signals_1.formatTokens)(contextTokens));
    if (hasHeldPrompt)
        return "".concat(context, " and this prompt starts new work.");
    if (signal === 'strong')
        return "".concat(context, " and the task just finished.");
    return isBusy ? "".concat(context, " and background work is still running.") : "".concat(context, ".");
};
var bandMessage = function (offer) {
    return "".concat(situation(offer), " Accuracy drops as context grows. ").concat(question(offer));
};
exports.bandMessage = bandMessage;
