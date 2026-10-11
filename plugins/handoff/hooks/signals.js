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
exports.busyRefusalTrigger = exports.respond = exports.bandButtons = exports.classify = exports.formatTokens = exports.contextFromStep = exports.asThreshold = exports.asMode = void 0;
var MODES = ['off', 'ask', 'act'];
var isMode = function (value) { return MODES.some(function (mode) { return mode === value; }); };
var asMode = function (value) {
    return isMode(value) ? value : 'off';
};
exports.asMode = asMode;
var DEFAULT_THRESHOLD = 150000;
var MIN_THRESHOLD = 80000;
var MAX_THRESHOLD = 2000000;
var asThreshold = function (value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value))
        : DEFAULT_THRESHOLD;
};
exports.asThreshold = asThreshold;
var contextFromStep = function (_a) {
    var input = _a.input, created = _a.created, read = _a.read, advisorCalls = _a.advisorCalls, reported = _a.reported;
    var perCall = (input + created + read) / (1 + advisorCalls);
    return Math.round(reported === undefined ? perCall : Math.min(reported, perCall));
};
exports.contextFromStep = contextFromStep;
var formatTokens = function (tokens) { return "".concat(Math.round(tokens / 1000), "k"); };
exports.formatTokens = formatTokens;
var classify = function (_a) {
    var contextTokens = _a.contextTokens, threshold = _a.threshold, isStoppingPoint = _a.isStoppingPoint, isBackgroundBusy = _a.isBackgroundBusy;
    if (contextTokens < threshold)
        return 'none';
    return isStoppingPoint && !isBackgroundBusy ? 'strong' : 'weak';
};
exports.classify = classify;
var NONE = { kind: 'none' };
var bandButtons = function (_a) {
    var signal = _a.signal, hasHeldPrompt = _a.hasHeldPrompt, isBusy = _a.isBusy;
    if (hasHeldPrompt)
        return isBusy ? ['send-here'] : ['handoff-send', 'send-here'];
    if (signal === 'strong')
        return ['handoff', 'not-now'];
    return isBusy ? ['compact', 'not-now'] : ['compact', 'handoff', 'not-now'];
};
exports.bandButtons = bandButtons;
var respondToStrong = function (mode, stoppingPoint) {
    var holdsPrompt = stoppingPoint === 'new-work';
    if (mode === 'act')
        return { kind: 'handoff', holdsPrompt: holdsPrompt };
    var buttons = (0, exports.bandButtons)({ signal: 'strong', hasHeldPrompt: holdsPrompt, isBusy: false });
    return { kind: 'advise', holdsPrompt: holdsPrompt, buttons: buttons };
};
var respondToWeak = function (mode, isBusy) {
    if (mode === 'act')
        return { kind: 'compact' };
    return { kind: 'advise', holdsPrompt: false, buttons: (0, exports.bandButtons)({ signal: 'weak', hasHeldPrompt: false, isBusy: isBusy }) };
};
var respond = function (_a) {
    var mode = _a.mode, signal = _a.signal, stoppingPoint = _a.stoppingPoint, isBackgroundBusy = _a.isBackgroundBusy, isUnattended = _a.isUnattended;
    if (mode === 'off' || signal === 'none')
        return NONE;
    if (isUnattended)
        return signal === 'strong' ? { kind: 'handoff', holdsPrompt: stoppingPoint === 'new-work' } : NONE;
    return signal === 'strong' ? respondToStrong(mode, stoppingPoint) : respondToWeak(mode, isBackgroundBusy);
};
exports.respond = respond;
// The decision-time snapshot predates a busy refusal, and classify() gives a weak signal whenever work is busy.
var busyRefusalTrigger = function (trigger) { return (__assign(__assign({}, trigger), { isBusy: true, signal: 'weak' })); };
exports.busyRefusalTrigger = busyRefusalTrigger;
