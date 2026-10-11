"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planTurnEnd = exports.isBackedOff = void 0;
var signals_1 = require("./signals");
var BACKOFF_TOKENS = 50000;
var isBackedOff = function (_a) {
    var backoffFrom = _a.backoffFrom, contextTokens = _a.contextTokens;
    return backoffFrom !== null && contextTokens < backoffFrom + BACKOFF_TOKENS;
};
exports.isBackedOff = isBackedOff;
var planTurnEnd = function (input) {
    var signal = (0, signals_1.classify)({
        contextTokens: input.contextTokens,
        threshold: input.threshold,
        isStoppingPoint: input.hasFinishedTask,
        isBackgroundBusy: input.isBackgroundBusy,
    });
    if (signal === 'weak' && (0, exports.isBackedOff)(input))
        return { signal: signal, outcome: { kind: 'back-off' } };
    var outcome = (0, signals_1.respond)({
        mode: input.mode,
        signal: signal,
        stoppingPoint: input.hasFinishedTask ? 'finished-task' : null,
        isBackgroundBusy: input.isBackgroundBusy,
        isUnattended: input.isUnattended,
    });
    return { signal: signal, outcome: outcome };
};
exports.planTurnEnd = planTurnEnd;
