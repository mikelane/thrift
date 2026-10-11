"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReadmeReasons = exports.driftExitCode = exports.formatDriftMessages = exports.findReasonDrift = void 0;
var REASON_ROW_KEY = '`trigger_values.reason`';
var withoutParentheses = function (text) {
    var stripped = text.replace(/\([^()]*\)/g, '');
    return stripped === text ? text : withoutParentheses(stripped);
};
var splitOnUnescapedPipes = function (line) { return line.split(/(?<!\\)\|/); };
var findReasonDrift = function (declaredReasons, documentedReasons) {
    var declared = new Set(declaredReasons);
    var documented = new Set(documentedReasons);
    return {
        missingFromReadme: __spreadArray([], declared, true).filter(function (reason) { return !documented.has(reason); }),
        missingFromUnion: __spreadArray([], documented, true).filter(function (reason) { return !declared.has(reason); }),
    };
};
exports.findReasonDrift = findReasonDrift;
var formatDriftMessages = function (_a) {
    var missingFromReadme = _a.missingFromReadme, missingFromUnion = _a.missingFromUnion;
    return __spreadArray(__spreadArray([], missingFromReadme.map(function (reason) { return "\"".concat(reason, "\" is in DECISION_REASONS but not in the README's trigger_values.reason row. Add it to the row, or remove it from DECISION_REASONS."); }), true), missingFromUnion.map(function (reason) { return "\"".concat(reason, "\" is in the README's trigger_values.reason row but not in DECISION_REASONS. Remove it from the row, or add it to DECISION_REASONS."); }), true);
};
exports.formatDriftMessages = formatDriftMessages;
var driftExitCode = function (messages) { return (messages.length === 0 ? 0 : 1); };
exports.driftExitCode = driftExitCode;
// SAFETY: The README table is written by hand. The parser does not support these valid Markdown
// shapes: a padded or double-backtick code span, a table with no leading pipe, and a fenced example
// row above the real row. Each one makes the check fail (no row, two rows, or values
// DECISION_REASONS does not have), so a misread row can never pass. An escaped `\|` inside a cell
// does not split the cell.
var parseReadmeReasons = function (readme) {
    var _a;
    var rows = readme.split('\n').filter(function (line) { var _a; return ((_a = splitOnUnescapedPipes(line)[1]) === null || _a === void 0 ? void 0 : _a.trim()) === REASON_ROW_KEY; });
    var row = rows[0], extraRows = rows.slice(1);
    if (row === undefined) {
        throw new Error("The README has no table row whose first cell is ".concat(REASON_ROW_KEY, ". Add one that lists every value in DECISION_REASONS."));
    }
    if (extraRows.length > 0) {
        throw new Error("The README has ".concat(rows.length, " table rows whose first cell is ").concat(REASON_ROW_KEY, ". Keep one and delete the others."));
    }
    var valueCell = (_a = splitOnUnescapedPipes(row)[2]) !== null && _a !== void 0 ? _a : '';
    var listed = withoutParentheses(valueCell);
    var afterLeadIn = listed.slice(listed.indexOf(':') + 1);
    // SAFETY: the capture group always matches, so `value` is never undefined. The check only narrows the type.
    return __spreadArray([], afterLeadIn.matchAll(/`([^`]+)`/g), true).flatMap(function (_a) {
        var value = _a[1];
        return (value === undefined ? [] : [value]);
    });
};
exports.parseReadmeReasons = parseReadmeReasons;
