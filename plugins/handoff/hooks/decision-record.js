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
exports.logLocation = exports.isUsableThriftHome = exports.recordFromEvaluation = exports.decisionRecord = exports.LOG_WRITER = exports.snapshotTrigger = exports.heldGroupFields = void 0;
var heldGroupFields = function (groups) { return ({
    held_groups: groups.length,
    held_unattended: groups.some(function (group) { return group.isUnattended; }),
}); };
exports.heldGroupFields = heldGroupFields;
var snapshotTrigger = function (state, point, signal, isBusy) { return ({
    point: point,
    signal: signal,
    isBusy: isBusy,
    contextTokens: state.contextTokens,
    cacheReadTokens: state.cacheReadTokens,
    effectiveMode: state.mode,
}); };
exports.snapshotTrigger = snapshotTrigger;
// umask only applies when the file is created, so a log that already exists is made owner-only by the chmod. `mkdir -p --`
// works on BSD and GNU alike. chmod takes no `--`: BSD chmod (macOS) reads it as a file operand, sets the mode, then fails on it
// and exits 1, while GNU chmod accepts it. The file is always absolute (see isUsableThriftHome), so it cannot read as an option.
exports.LOG_WRITER = ['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"', 'sh'];
// A person asked for these, so the plugin acted on their request whatever mode it ran in.
var isPersonAction = function (point) { return point === 'command' || point === 'button'; };
var decisionRecord = function (_a) {
    var now = _a.now, sessionId = _a.sessionId, action = _a.action, engineVersion = _a.engineVersion, effectiveMode = _a.effectiveMode, triggerValues = _a.triggerValues;
    return ({
        ts: new Date(now).toISOString(),
        session_id: sessionId,
        component: 'handoff',
        mode: action === 'none' && effectiveMode === 'off' && !isPersonAction(triggerValues.point) ? 'shadow' : 'active',
        action: action,
        engine_version: engineVersion,
        trigger_values: __assign(__assign({}, triggerValues), { effective_mode: effectiveMode }),
    });
};
exports.decisionRecord = decisionRecord;
var recordFromEvaluation = function (state, evaluation, now, sessionId) {
    var action = evaluation.action, point = evaluation.point, signal = evaluation.signal, isBusy = evaluation.isBusy, contextTokens = evaluation.contextTokens, cacheReadTokens = evaluation.cacheReadTokens, effectiveMode = evaluation.effectiveMode, reason = evaluation.reason, note = evaluation.note, clearedBy = evaluation.clearedBy, compactedBeforeClear = evaluation.compactedBeforeClear, heldFields = evaluation.heldFields;
    var compactedFields = compactedBeforeClear ? { compacted_before_clear: true } : {};
    return (0, exports.decisionRecord)({
        now: now,
        sessionId: sessionId,
        action: action,
        engineVersion: state.engineVersion,
        effectiveMode: effectiveMode,
        triggerValues: __assign(__assign(__assign(__assign(__assign({ point: point, signal: signal, context_tokens: contextTokens, threshold: state.threshold, is_background_busy: isBusy, setting: state.setting, cache_read_tokens: cacheReadTokens }, (reason ? { reason: reason } : {})), (note ? { note: note } : {})), (clearedBy ? { cleared_by: clearedBy } : {})), compactedFields), heldFields),
    });
};
exports.recordFromEvaluation = recordFromEvaluation;
// A relative THRIFT_HOME, or one that starts with ~, would resolve against the session's working directory, not the home.
var isUsableThriftHome = function (thriftHome) { return (thriftHome === null || thriftHome === void 0 ? void 0 : thriftHome.startsWith('/')) === true; };
exports.isUsableThriftHome = isUsableThriftHome;
var logLocation = function (thriftHome, home) {
    var dir = (0, exports.isUsableThriftHome)(thriftHome) ? thriftHome.replace(/\/+$/, '') : home ? "".concat(home.replace(/\/+$/, ''), "/.claude/thrift") : null;
    // THRIFT_HOME=/ strips to nothing: the log then goes in the root directory itself, as asked.
    if (dir === '')
        return { dir: '/', file: '/decisions.jsonl' };
    return dir === null ? null : { dir: dir, file: "".concat(dir, "/decisions.jsonl") };
};
exports.logLocation = logLocation;
