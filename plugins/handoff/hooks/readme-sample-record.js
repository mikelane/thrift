"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findSampleDrift = exports.rebuildSampleLine = exports.extractReadmeSampleLine = void 0;
var SAMPLE_LINE = /^\{"ts":/;
var isObject = function (value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};
var isOptional = function (value, type) {
    return value === undefined || typeof value === type;
};
// Proves the shape the rebuild reads. Literal-union members (signal, action, reason, ...) are not checked here: that
// needs the domain's value lists at runtime, which this module cannot import.
var isSampleRecord = function (value) {
    if (!isObject(value) || !isObject(value.trigger_values))
        return false;
    var values = value.trigger_values;
    return (typeof value.ts === 'string' &&
        typeof value.session_id === 'string' &&
        typeof value.action === 'string' &&
        typeof value.engine_version === 'string' &&
        typeof values.point === 'string' &&
        typeof values.signal === 'string' &&
        typeof values.is_background_busy === 'boolean' &&
        typeof values.context_tokens === 'number' &&
        typeof values.cache_read_tokens === 'number' &&
        typeof values.threshold === 'number' &&
        typeof values.setting === 'string' &&
        typeof values.effective_mode === 'string' &&
        isOptional(values.reason, 'string') &&
        isOptional(values.note, 'string') &&
        isOptional(values.cleared_by, 'string') &&
        (values.compacted_before_clear === undefined || values.compacted_before_clear === true) &&
        isOptional(values.held_groups, 'number') &&
        isOptional(values.held_unattended, 'boolean') &&
        isOptional(values.handoff_unattended, 'boolean') &&
        isOptional(values.held_other_delivery, 'string') &&
        isOptional(values.held_restore, 'string'));
};
var extractReadmeSampleLine = function (readme) {
    var lines = readme.split('\n').filter(function (line) { return SAMPLE_LINE.test(line); });
    var line = lines[0], extraLines = lines.slice(1);
    if (line === undefined)
        throw new Error('The README has no sample record line (a line that starts with {"ts":).');
    if (extraLines.length > 0)
        throw new Error("The README has ".concat(lines.length, " sample record lines. Keep one."));
    return line;
};
exports.extractReadmeSampleLine = extractReadmeSampleLine;
// The inverse of the builder: the README line supplies every field, so a key the builder places differently,
// renames, or does not write shows up as a difference from the line itself.
var rebuildSampleLine = function (line, build) {
    var _a, _b;
    var sample = JSON.parse(line);
    if (!isSampleRecord(sample))
        throw new Error("The README sample record does not have the fields a record holds: ".concat(line));
    var values = sample.trigger_values;
    var hasHeldFields = values.held_groups !== undefined;
    var evaluation = {
        point: values.point,
        signal: values.signal,
        isBusy: values.is_background_busy,
        contextTokens: values.context_tokens,
        cacheReadTokens: values.cache_read_tokens,
        effectiveMode: values.effective_mode,
        action: sample.action,
        reason: values.reason,
        note: values.note,
        clearedBy: values.cleared_by,
        compactedBeforeClear: values.compacted_before_clear,
        heldFields: hasHeldFields
            ? {
                held_groups: (_a = values.held_groups) !== null && _a !== void 0 ? _a : 0,
                held_unattended: (_b = values.held_unattended) !== null && _b !== void 0 ? _b : false,
                handoff_unattended: values.handoff_unattended,
                held_other_delivery: values.held_other_delivery,
                held_restore: values.held_restore,
            }
            : undefined,
    };
    var state = {
        setting: values.setting,
        threshold: values.threshold,
        engineVersion: sample.engine_version,
    };
    return JSON.stringify(build(state, evaluation, Date.parse(sample.ts), sample.session_id));
};
exports.rebuildSampleLine = rebuildSampleLine;
var findSampleDrift = function (readme, build) {
    var line = (0, exports.extractReadmeSampleLine)(readme);
    var rebuilt = (0, exports.rebuildSampleLine)(line, build);
    return rebuilt === line
        ? []
        : ["The README sample record differs from what recordFromEvaluation writes for its fields.\nREADME: ".concat(line, "\nbuilt:  ").concat(rebuilt)];
};
exports.findSampleDrift = findSampleDrift;
