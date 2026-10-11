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
exports.namesNewWork = exports.workRefs = exports.hasTicketShapedToken = exports.branchTicketPrefixes = exports.ticketUrlPrefixes = void 0;
var TICKET_TOKEN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b/g;
var TICKET_URL = /https?:\/\/\S*?\/(?:issue|browse)\/([A-Za-z][A-Za-z0-9]{1,9})-\d+/gi;
var PR_REFERENCE = /\b(?:pr|issue|pull request)\s*#?(\d+)\b/gi;
var PR_URL = /\/(?:pull|issues)\/(\d+)\b/g;
var unique = function (values) { return __spreadArray([], new Set(values), true); };
var ticketUrlPrefixes = function (text) {
    return unique(__spreadArray([], text.matchAll(TICKET_URL), true).map(function (_a) {
        var _b = _a[1], prefix = _b === void 0 ? '' : _b;
        return prefix.toUpperCase();
    }));
};
exports.ticketUrlPrefixes = ticketUrlPrefixes;
var branchTicketPrefixes = function (branch) {
    return unique(__spreadArray([], branch.matchAll(TICKET_TOKEN), true).map(function (_a) {
        var _b = _a[1], prefix = _b === void 0 ? '' : _b;
        return prefix.toUpperCase();
    }));
};
exports.branchTicketPrefixes = branchTicketPrefixes;
var hasTicketShapedToken = function (text) { return new RegExp(TICKET_TOKEN.source).test(text); };
exports.hasTicketShapedToken = hasTicketShapedToken;
var workRefs = function (text, prefixes) {
    var known = new Set(prefixes.map(function (prefix) { return prefix.toUpperCase(); }));
    var tickets = __spreadArray([], text.matchAll(TICKET_TOKEN), true).map(function (_a) {
        var _b = _a[1], prefix = _b === void 0 ? '' : _b, _c = _a[2], digits = _c === void 0 ? '' : _c;
        return [prefix.toUpperCase(), digits];
    })
        .filter(function (_a) {
        var prefix = _a[0];
        return known.has(prefix);
    })
        .map(function (_a) {
        var prefix = _a[0], digits = _a[1];
        return "".concat(prefix, "-").concat(digits);
    });
    var pullRequests = __spreadArray(__spreadArray([], text.matchAll(PR_REFERENCE), true), text.matchAll(PR_URL), true).map(function (_a) {
        var _b = _a[1], digits = _b === void 0 ? '' : _b;
        return "#".concat(digits);
    });
    return unique(__spreadArray(__spreadArray([], tickets, true), pullRequests, true));
};
exports.workRefs = workRefs;
var namesNewWork = function (text, seen, prefixes) {
    var named = (0, exports.workRefs)(text, prefixes);
    return seen.size > 0 && named.length > 0 && named.every(function (ref) { return !seen.has(ref); });
};
exports.namesNewWork = namesNewWork;
