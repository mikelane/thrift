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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncDelegator = (this && this.__asyncDelegator) || function (o) {
    var i, p;
    return i = {}, verb("next"), verb("throw", function (e) { throw e; }), verb("return"), i[Symbol.iterator] = function () { return this; }, i;
    function verb(n, f) { i[n] = o[n] ? function (v) { return (p = !p) ? { value: __await(o[n](v)), done: false } : f ? f(v) : v; } : f; }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = void 0;
var claude_code_1 = require("claude-code");
var band_text_1 = require("./band-text");
var decision_record_1 = require("./decision-record");
var engine_version_1 = require("./engine-version");
var handoff_note_1 = require("./handoff-note");
var held_delivery_1 = require("./held-delivery");
var prompt_plan_1 = require("./prompt-plan");
var session_state_1 = require("./session-state");
var signals_1 = require("./signals");
var tasks_1 = require("./tasks");
var tool_call_tracking_1 = require("./tool-call-tracking");
var turn_end_plan_1 = require("./turn-end-plan");
var work_refs_1 = require("./work-refs");
var BRANCH_READ_TIMEOUT_MS = 5000;
var BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting']);
var WRITING_COMMAND_REPLY = 'Writing a handoff for a fresh session...';
var HANDING_OFF_FIRST = 'Handing off first. Your prompt will be sent in the fresh session.';
var HELD_PROMPT = 'Held your prompt. Choose below, or press Enter again to send it here.';
var PRESS_WAITS_FOR_TURN = 'This turn is still running, so your choice will run when it ends.';
var HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript.";
var REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.';
var REFUSED_DURING_HANDOFF = 'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.';
var REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after.";
var keptRefusedPrompt = function (kind, text) {
    return "A prompt from ".concat((0, prompt_plan_1.senderLabel)(kind), " had attachments or context, so it could not be held during the handoff and did not run. Its attachments and context were not kept. Its text, to send again after the handoff:\n").concat(text);
};
var PROMPT_NOT_HELD = 'That prompt is no longer held, so there is nothing to send.';
var ALREADY_PENDING = 'A handoff or compaction is already in progress.';
var UNSENT_PROMPT = 'Your prompt could not be sent or put in the prompt box. Here it is:';
var UNSENT_NOTE = 'The handoff note could not be sent or put in the prompt box. Here it is:';
var UNSENT_UNATTENDED_NOTE = 'The handoff note could not be sent, so here it is:';
var UNSENT_OTHER_PROMPT = 'A prompt could not be sent, so here it is:';
var UNSENT_NOTE_AND_PROMPT = 'The handoff note and your prompt could not be sent or put in the prompt box. Here they are:';
var UNSENT_NOTE_AND_OTHER_PROMPT = 'The handoff note and a prompt could not be sent, so here they are:';
// /handoff is registered only when a person is at the prompt, so only then is it there to mention.
var untestedEngineNotice = function (engineVersion, isInteractive) {
    return "Untested on Claude Code ".concat(engineVersion, ", so this session only logs decisions.").concat(isInteractive ? ' /handoff still works.' : '');
};
var offerAtom = (0, claude_code_1.atom)({ plugin: 'handoff', key: 'offer' }, null);
var debug = function ($, line) { return $.ui.log("handoff: ".concat(line), { to: 'debug' }); };
var writeRecord = function ($, state, evaluation) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, now, id, thriftHome, home, location_1, isThriftHomeIgnored, record, ran, error_1;
    var _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _c.trys.push([0, 3, , 4]);
                return [4 /*yield*/, Promise.all([
                        $.clock.now(),
                        (_b = evaluation.sessionId) !== null && _b !== void 0 ? _b : $.session.id(),
                        $.env.get('THRIFT_HOME'),
                        $.env.get('HOME'),
                    ])];
            case 1:
                _a = _c.sent(), now = _a[0], id = _a[1], thriftHome = _a[2], home = _a[3];
                location_1 = (0, decision_record_1.logLocation)(thriftHome, home);
                isThriftHomeIgnored = Boolean(thriftHome) && !(0, decision_record_1.isUsableThriftHome)(thriftHome);
                if (isThriftHomeIgnored) {
                    debug($, "THRIFT_HOME is not an absolute path, so ".concat(location_1 === null ? 'HOME is needed for a log location, and it is not set' : 'the default log location is used'));
                }
                if (location_1 === null)
                    return [2 /*return*/, isThriftHomeIgnored ? undefined : debug($, 'no log location: neither THRIFT_HOME nor HOME is set')];
                record = (0, decision_record_1.recordFromEvaluation)(state, evaluation, now, id);
                return [4 /*yield*/, $.process.run(__spreadArray(__spreadArray([], decision_record_1.LOG_WRITER, true), [location_1.dir, location_1.file], false), {
                        stdin: "".concat(JSON.stringify(record), "\n"),
                    })];
            case 2:
                ran = _c.sent();
                if (ran.exitCode !== 0)
                    debug($, "log write failed: ".concat(ran.stderr.trim()));
                return [3 /*break*/, 4];
            case 3:
                error_1 = _c.sent();
                debug($, "log write failed: ".concat(String(error_1)));
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); };
var isBackgroundBusy = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    var error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (state.backgroundTasks.size > 0)
                    return [2 /*return*/, true];
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, $.agent.list()];
            case 2: return [2 /*return*/, (_a.sent()).some(function (agent) { return BUSY_AGENT_STATUSES.has(agent.status); })];
            case 3:
                error_2 = _a.sent();
                debug($, "could not list agents, treating background work as busy: ".concat(String(error_2)));
                return [2 /*return*/, true];
            case 4: return [2 /*return*/];
        }
    });
}); };
var readVersion = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, version, base, error_3;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.session.version()];
            case 1:
                _a = _b.sent(), version = _a.version, base = _a.base;
                return [2 /*return*/, { engineVersion: base !== null && base !== void 0 ? base : version, base: base }];
            case 2:
                error_3 = _b.sent();
                debug($, "could not read the engine version: ".concat(String(error_3)));
                return [2 /*return*/, { engineVersion: 'unknown', base: undefined }];
            case 3: return [2 /*return*/];
        }
    });
}); };
var reportedContext = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.session.usage()];
            case 1: return [2 /*return*/, (_a.sent()).context.tokens];
            case 2:
                error_4 = _a.sent();
                debug($, "could not read session usage: ".concat(String(error_4)));
                return [2 /*return*/, undefined];
            case 3: return [2 /*return*/];
        }
    });
}); };
var runCompaction = function ($, state, trigger) { return __awaiter(void 0, void 0, void 0, function () {
    var sizeBefore, compaction, error_5;
    var _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                sizeBefore = state.contextTokens;
                _c.label = 1;
            case 1:
                _c.trys.push([1, 7, 9, 10]);
                return [4 /*yield*/, $.session.compact()];
            case 2:
                compaction = _c.sent();
                if (!(compaction.skip !== undefined)) return [3 /*break*/, 4];
                state.backoffFrom = sizeBefore;
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'compaction_vetoed' }))];
            case 3:
                _c.sent();
                return [3 /*break*/, 6];
            case 4: return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'compacted' }))];
            case 5:
                _c.sent();
                state.backoffFrom = (_a = compaction.tokensAfter) !== null && _a !== void 0 ? _a : sizeBefore;
                state.contextTokens = (_b = compaction.tokensAfter) !== null && _b !== void 0 ? _b : sizeBefore;
                _c.label = 6;
            case 6: return [3 /*break*/, 10];
            case 7:
                error_5 = _c.sent();
                state.backoffFrom = sizeBefore;
                debug($, "compaction failed: ".concat(String(error_5)));
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'compaction_failed' }))];
            case 8:
                _c.sent();
                return [3 /*break*/, 10];
            case 9:
                state.pending = null;
                return [7 /*endfinally*/];
            case 10: return [2 /*return*/];
        }
    });
}); };
var scheduleCompaction = function ($, state, trigger) {
    if (!(0, session_state_1.claimPending)(state, 'compact'))
        return false;
    $.clock.after(0, function () {
        void logFailure($, runCompaction($, state, trigger));
    });
    return true;
};
var takeDownBand = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    var error_6;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!state.hasBand)
                    return [2 /*return*/];
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, claude_code_1.update)($, offerAtom, function () { return null; })];
            case 2:
                _a.sent();
                state.hasBand = false;
                return [3 /*break*/, 4];
            case 3:
                error_6 = _a.sent();
                debug($, "could not take down the band: ".concat(String(error_6)));
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); };
// The offer atom outlives a reload but `state.hasBand` does not, so a band left up would stick.
var takeDownBandFromBeforeReload = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    var error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, (0, claude_code_1.read)($, offerAtom)];
            case 1:
                if ((_a.sent()) !== null)
                    state.hasBand = true;
                return [3 /*break*/, 3];
            case 2:
                error_7 = _a.sent();
                debug($, "could not read the band: ".concat(String(error_7)));
                return [3 /*break*/, 3];
            case 3: return [4 /*yield*/, takeDownBand($, state)];
            case 4:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
var offerBand = function ($, state, trigger, hasHeldPrompt) { return __awaiter(void 0, void 0, void 0, function () {
    var offer, error_8;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                offer = {
                    signal: trigger.signal === 'strong' ? 'strong' : 'weak',
                    contextTokens: trigger.contextTokens,
                    hasHeldPrompt: hasHeldPrompt,
                    isBusy: trigger.isBusy,
                };
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 6]);
                return [4 /*yield*/, (0, claude_code_1.update)($, offerAtom, function () { return offer; })];
            case 2:
                _a.sent();
                state.hasBand = true;
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'advised' }))];
            case 3:
                _a.sent();
                return [3 /*break*/, 6];
            case 4:
                error_8 = _a.sent();
                debug($, "could not show the band: ".concat(String(error_8)));
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'band_failed' }))];
            case 5:
                _a.sent();
                return [3 /*break*/, 6];
            case 6: return [2 /*return*/];
        }
    });
}); };
var registerHandoffCommand = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var error_9;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.command.register({
                        name: 'handoff',
                        description: 'Write a handoff, clear, and continue in a fresh session',
                    })];
            case 1:
                _a.sent();
                return [3 /*break*/, 3];
            case 2:
                error_9 = _a.sent();
                debug($, "could not register /handoff: ".concat(String(error_9)));
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); };
// SAFETY: every current caller catches its own engine failures, so no test reaches this catch.
// Keep it: it is the only guard against an unhandled rejection if a future caller forgets.
var logFailure = function ($, work) {
    return work.catch(function (error) { return debug($, "background work failed: ".concat(String(error))); });
};
// A prompt the box already holds as whole lines is not added again, so an identical prompt sent twice shows once; the box
// is for the person to review and send, and a second copy of a line they can see would only be noise to delete.
var refillBox = function ($_1, text_1) {
    var args_1 = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        args_1[_i - 2] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([$_1, text_1], args_1, true), void 0, function ($, text, placement) {
        var draft, withDraft, filled, error_10;
        var _a;
        if (placement === void 0) { placement = 'before_draft'; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, $.prompt.read()];
                case 1:
                    draft = (_b.sent()).text;
                    if ((0, handoff_note_1.holdsPrompt)(draft, text))
                        return [2 /*return*/, true];
                    withDraft = placement === 'before_draft' ? "".concat(text, "\n").concat(draft) : "".concat(draft, "\n").concat(text);
                    return [4 /*yield*/, $.prompt.fill({ text: draft === '' ? text : withDraft, mode: 'replace' })];
                case 2:
                    filled = _b.sent();
                    if (!filled.isFilled)
                        debug($, "the prompt box refused the prompt: ".concat((_a = filled.refusal) !== null && _a !== void 0 ? _a : 'refused by a hook'));
                    return [2 /*return*/, filled.isFilled];
                case 3:
                    error_10 = _b.sent();
                    debug($, "could not refill the prompt box: ".concat(String(error_10)));
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
};
var composerPrompt = function (text) { return ({ text: text, isUnattended: false, origin: 'composer' }); };
// Only a prompt typed at this terminal is offered to the box. The sender of any other prompt is somewhere else, and filling
// the box could displace the draft of the person who is here.
var canUseBox = function (prompt) { return (0, prompt_plan_1.isComposerOrigin)(prompt.origin); };
// A prompt that is never offered to the box is not the person's own, so it gets a notice that claims neither.
var keepInTranscript = function ($, prompt, notice) {
    return $.ui.log("".concat(notice !== null && notice !== void 0 ? notice : (canUseBox(prompt) ? UNSENT_PROMPT : UNSENT_OTHER_PROMPT), "\n").concat(prompt.text));
};
// The engine cannot submit a prompt under another origin: the plugin's submission arrives as origin 'plugin', which this
// plugin's prompt.submit hook does not classify. Submit resolves once the prompt's turn started or once it was queued behind
// the running turn, so a resolved submit does not mean its turn has begun. So the origin goes into a queue here and the
// turn.start hook takes it. A hook beneath the plugin that refuses the prompt makes submit resolve with { drop } instead of
// rejecting.
var submitEntered = function ($, state, prompt, failureLabel) { return __awaiter(void 0, void 0, void 0, function () {
    var result, error_11;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                (0, session_state_1.queueResubmittedPrompt)(state, prompt);
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, $.prompt.submit({ text: prompt.text })];
            case 2:
                result = _a.sent();
                if (result.drop === undefined)
                    return [2 /*return*/, true];
                debug($, "".concat(failureLabel, ": ").concat(result.drop));
                return [3 /*break*/, 4];
            case 3:
                error_11 = _a.sent();
                debug($, "".concat(failureLabel, ": ").concat(String(error_11)));
                return [3 /*break*/, 4];
            case 4:
                (0, session_state_1.removeResubmittedPrompt)(state, prompt);
                return [2 /*return*/, false];
        }
    });
}); };
var submitOrKeepInTranscript = function ($, state, prompt) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, submitEntered($, state, prompt, 'could not restore the held prompt')];
            case 1:
                if (_a.sent())
                    return [2 /*return*/, 'submitted'];
                keepInTranscript($, prompt);
                return [2 /*return*/, 'not_carried'];
        }
    });
}); };
var restorePrompt = function ($_1, state_1, prompt_1) {
    var args_1 = [];
    for (var _i = 3; _i < arguments.length; _i++) {
        args_1[_i - 3] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([$_1, state_1, prompt_1], args_1, true), void 0, function ($, state, prompt, placement) {
        var _a;
        if (placement === void 0) { placement = 'before_draft'; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = canUseBox(prompt);
                    if (!_a) return [3 /*break*/, 2];
                    return [4 /*yield*/, refillBox($, prompt.text, placement)];
                case 1:
                    _a = (_b.sent());
                    _b.label = 2;
                case 2:
                    if (_a)
                        return [2 /*return*/, 'in_box'];
                    return [2 /*return*/, submitOrKeepInTranscript($, state, prompt)];
            }
        });
    });
};
// A failed read leaves the id to writeRecord, which reads it again. If that fails too, no record is written and
// writeRecord leaves its own debug line.
var readSessionId = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var error_12;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.session.id()];
            case 1: return [2 /*return*/, _a.sent()];
            case 2:
                error_12 = _a.sent();
                debug($, "could not read the session id: ".concat(String(error_12)));
                return [2 /*return*/, undefined];
            case 3: return [2 /*return*/];
        }
    });
}); };
var restoreHeldGroups = function ($, state, settledHandoff) { return __awaiter(void 0, void 0, void 0, function () {
    var restores, _i, _a, group, _b, _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                restores = [];
                _i = 0, _a = settledHandoff.heldGroups;
                _d.label = 1;
            case 1:
                if (!(_i < _a.length)) return [3 /*break*/, 4];
                group = _a[_i];
                _c = (_b = restores).push;
                return [4 /*yield*/, restorePrompt($, state, group)];
            case 2:
                _c.apply(_b, [_d.sent()]);
                (0, session_state_1.releaseCarriedGroup)(state, group, settledHandoff.isUnattended);
                _d.label = 3;
            case 3:
                _i++;
                return [3 /*break*/, 1];
            case 4: return [2 /*return*/, restores];
        }
    });
}); };
// Prompts that arrived during a delivery or a restore go back one by one in arrival order, and more may arrive while they do.
var forEachLateArrival = function (state, carryPrompt) { return __awaiter(void 0, void 0, void 0, function () {
    var prompts, deliveries, arrived, _i, arrived_1, prompt_1, _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                prompts = [];
                deliveries = [];
                arrived = (0, session_state_1.takeLateArrivalsOrEndSending)(state);
                _c.label = 1;
            case 1:
                if (!(arrived.length > 0)) return [3 /*break*/, 7];
                _i = 0, arrived_1 = arrived;
                _c.label = 2;
            case 2:
                if (!(_i < arrived_1.length)) return [3 /*break*/, 5];
                prompt_1 = arrived_1[_i];
                _b = (_a = deliveries).push;
                return [4 /*yield*/, carryPrompt(prompt_1)];
            case 3:
                _b.apply(_a, [_c.sent()]);
                _c.label = 4;
            case 4:
                _i++;
                return [3 /*break*/, 2];
            case 5:
                prompts.push.apply(prompts, arrived);
                _c.label = 6;
            case 6:
                arrived = (0, session_state_1.takeLateArrivalsOrEndSending)(state);
                return [3 /*break*/, 1];
            case 7: return [2 /*return*/, { prompts: prompts, deliveries: deliveries }];
        }
    });
}); };
var restoreLateArrivals = function ($, state) {
    return forEachLateArrival(state, function (prompt) { return restorePrompt($, state, prompt, 'after_draft'); });
};
var abandonHandoff = function ($, state, settledHandoff, reason, message, sessionId) { return __awaiter(void 0, void 0, void 0, function () {
    var recordedSessionId, _a, restores, late;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                // Before the first await, as in continueInFreshSession: the caller took the held prompts in the same synchronous run, so a
                // prompt that arrives while they are restored is held until they, and every prompt that arrived meanwhile, are back.
                (0, session_state_1.beginSending)(state);
                return [4 /*yield*/, takeDownBand($, state)];
            case 1:
                _b.sent();
                announce($, message);
                if (!(sessionId !== null && sessionId !== void 0)) return [3 /*break*/, 2];
                _a = sessionId;
                return [3 /*break*/, 4];
            case 2: return [4 /*yield*/, readSessionId($)];
            case 3:
                _a = (_b.sent());
                _b.label = 4;
            case 4:
                recordedSessionId = _a;
                return [4 /*yield*/, restoreHeldGroups($, state, settledHandoff)];
            case 5:
                restores = _b.sent();
                return [4 /*yield*/, restoreLateArrivals($, state)];
            case 6:
                late = _b.sent();
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, settledHandoff.trigger), { action: 'none', reason: reason, compactedBeforeClear: settledHandoff.hasCompactedBeforeClear, heldFields: __assign(__assign({}, (0, decision_record_1.heldGroupFields)((0, handoff_note_1.groupHeldPrompts)(__spreadArray(__spreadArray([], settledHandoff.heldGroups, true), late.prompts, true)))), { handoff_unattended: settledHandoff.isUnattended, held_restore: (0, held_delivery_1.worstDelivery)(__spreadArray(__spreadArray([], restores, true), late.deliveries, true)) }), sessionId: recordedSessionId }))];
            case 7:
                _b.sent();
                return [2 /*return*/];
        }
    });
}); };
var writeNote = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var answer, error_13;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.model.fork({ prompt: handoff_note_1.HANDOFF_PROMPT })];
            case 1:
                answer = _a.sent();
                return [2 /*return*/, answer.isAnswered && answer.text.trim() !== '' ? answer.text.trim() : null];
            case 2:
                error_13 = _a.sent();
                debug($, "could not write the handoff note: ".concat(String(error_13)));
                return [2 /*return*/, null];
            case 3: return [2 /*return*/];
        }
    });
}); };
// Whether the session was compacted: a vetoed or failed compaction leaves it as it was.
var compactBeforeClearing = function ($, state, trigger, sessionId) { return __awaiter(void 0, void 0, void 0, function () {
    var compaction, error_14;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 5]);
                return [4 /*yield*/, $.session.compact()];
            case 1:
                compaction = _a.sent();
                if (compaction.skip === undefined)
                    return [2 /*return*/, true];
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'compaction_vetoed', sessionId: sessionId }))];
            case 2:
                _a.sent();
                return [3 /*break*/, 5];
            case 3:
                error_14 = _a.sent();
                debug($, "compaction before the clear failed: ".concat(String(error_14)));
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'compaction_failed', sessionId: sessionId }))];
            case 4:
                _a.sent();
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/, false];
        }
    });
}); };
var clearSession = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var error_15;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.command.run({ command: 'clear' })];
            case 1:
                _a.sent();
                return [2 /*return*/, true];
            case 2:
                error_15 = _a.sent();
                debug($, "/clear failed: ".concat(String(error_15)));
                return [2 /*return*/, false];
            case 3: return [2 /*return*/];
        }
    });
}); };
var appendNote = function ($, message) { return __awaiter(void 0, void 0, void 0, function () {
    var appended, error_16;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.session.append({ message: { type: 'user', content: [{ type: 'text', text: message }] } })];
            case 1:
                appended = _a.sent();
                if (appended.deny === undefined)
                    return [2 /*return*/, true];
                debug($, "append denied: ".concat(appended.deny));
                return [2 /*return*/, false
                    // The test kit cannot make the default append reject: a throwing session.append hook is treated as a hook failure,
                    // and the plugin sees a successful append. Whether the live default append can reject is unverified.
                    // Keep it: without it, a rejected append skips the prompt fallback and drops the handoff note.
                ];
            case 2:
                error_16 = _a.sent();
                debug($, "append failed: ".concat(String(error_16)));
                return [2 /*return*/, false];
            case 3: return [2 /*return*/];
        }
    });
}); };
var sendOrKeepInBox = function ($_1, state_1, prompt_2) {
    var args_1 = [];
    for (var _i = 3; _i < arguments.length; _i++) {
        args_1[_i - 3] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([$_1, state_1, prompt_2], args_1, true), void 0, function ($, state, prompt, _a) {
        var _b;
        var _c = _a === void 0 ? {} : _a, _d = _c.placement, placement = _d === void 0 ? 'before_draft' : _d, notice = _c.notice;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, submitEntered($, state, prompt, 'could not send the prompt')];
                case 1:
                    if (_e.sent())
                        return [2 /*return*/, 'submitted'];
                    _b = canUseBox(prompt);
                    if (!_b) return [3 /*break*/, 3];
                    return [4 /*yield*/, refillBox($, prompt.text, placement)];
                case 2:
                    _b = (_e.sent());
                    _e.label = 3;
                case 3:
                    if (_b)
                        return [2 /*return*/, 'in_box'];
                    keepInTranscript($, prompt, notice);
                    return [2 /*return*/, 'not_carried'];
            }
        });
    });
};
var announce = function ($, message) {
    $.ui.log(message);
    $.ui.toast(message);
};
// The note rides with the prompts that follow the handoff's own origin; the other group is sent after it.
// A note that is never offered to the box (a scheduled handoff's, or one joined to a prompt typed elsewhere) gets a notice
// that does not say it was, and a note joined to a prompt names both.
var unsentNoteNotice = function (note, isJoined) {
    if (isJoined)
        return canUseBox(note) ? UNSENT_NOTE_AND_PROMPT : UNSENT_NOTE_AND_OTHER_PROMPT;
    return canUseBox(note) ? UNSENT_NOTE : UNSENT_UNATTENDED_NOTE;
};
var deliverNote = function ($, state, settledHandoff, message) { return __awaiter(void 0, void 0, void 0, function () {
    var sameOriginGroup, origin, note;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, appendNote($, message)];
            case 1:
                if (_b.sent())
                    return [2 /*return*/, 'appended'];
                sameOriginGroup = (0, handoff_note_1.groupJoiningNote)(settledHandoff.heldGroups, settledHandoff.isUnattended);
                origin = (_a = sameOriginGroup === null || sameOriginGroup === void 0 ? void 0 : sameOriginGroup.origin) !== null && _a !== void 0 ? _a : (0, prompt_plan_1.noteOrigin)(settledHandoff.isUnattended);
                note = { text: (0, handoff_note_1.joinPrompts)(message, sameOriginGroup === null || sameOriginGroup === void 0 ? void 0 : sameOriginGroup.text), isUnattended: settledHandoff.isUnattended, origin: origin };
                return [2 /*return*/, sendOrKeepInBox($, state, note, { notice: unsentNoteNotice(note, sameOriginGroup !== undefined) })];
        }
    });
}); };
var sendHeldGroups = function ($, state, groups, handoffIsUnattended) { return __awaiter(void 0, void 0, void 0, function () {
    var deliveries, _i, groups_1, group, _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                deliveries = [];
                _i = 0, groups_1 = groups;
                _c.label = 1;
            case 1:
                if (!(_i < groups_1.length)) return [3 /*break*/, 4];
                group = groups_1[_i];
                _b = (_a = deliveries).push;
                return [4 /*yield*/, sendOrKeepInBox($, state, group)];
            case 2:
                _b.apply(_a, [_c.sent()]);
                (0, session_state_1.releaseCarriedGroup)(state, group, handoffIsUnattended);
                _c.label = 3;
            case 3:
                _i++;
                return [3 /*break*/, 1];
            case 4: return [2 /*return*/, deliveries];
        }
    });
}); };
var sendLateArrivals = function ($, state) {
    return forEachLateArrival(state, function (prompt) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: 
                // Counted as seen like the held groups are before they go in, so a ticket named in a late prompt is not new work later.
                return [4 /*yield*/, inspectPrompt($, state, prompt.text)];
                case 1:
                    // Counted as seen like the held groups are before they go in, so a ticket named in a late prompt is not new work later.
                    _a.sent();
                    return [2 /*return*/, sendOrKeepInBox($, state, prompt, { placement: 'after_draft' })];
            }
        });
    }); });
};
var continueInFreshSession = function ($, state, settledHandoff, oldId, note, hasTurnAfterNote, clearedBy) { return __awaiter(void 0, void 0, void 0, function () {
    var noteDelivery, _i, _a, text, groupsToSend, deliveries, late;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                // Before the first await, so no prompt passes unheld after settleHandoff took the held ones: from here a prompt that
                // arrives is held until the note, the held prompts, and every prompt that arrived meanwhile have been delivered.
                (0, session_state_1.beginSending)(state);
                return [4 /*yield*/, registerHandoffCommand($)];
            case 1:
                _b.sent();
                return [4 /*yield*/, deliverNote($, state, settledHandoff, (0, handoff_note_1.handoffMessage)(oldId, note, hasTurnAfterNote))
                    // Without an appended note, deliverNote joined the carried group to the note and has now handed it over.
                ];
            case 2:
                noteDelivery = _b.sent();
                // Without an appended note, deliverNote joined the carried group to the note and has now handed it over.
                if (noteDelivery !== 'appended')
                    (0, session_state_1.releaseCarried)(state);
                announce($, handoff_note_1.FINAL_MESSAGES[noteDelivery](oldId));
                _i = 0, _a = settledHandoff.heldGroups;
                _b.label = 3;
            case 3:
                if (!(_i < _a.length)) return [3 /*break*/, 6];
                text = _a[_i].text;
                return [4 /*yield*/, inspectPrompt($, state, text)];
            case 4:
                _b.sent();
                _b.label = 5;
            case 5:
                _i++;
                return [3 /*break*/, 3];
            case 6:
                groupsToSend = (0, handoff_note_1.groupsLeftToSend)(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery);
                return [4 /*yield*/, sendHeldGroups($, state, groupsToSend, settledHandoff.isUnattended)];
            case 7:
                deliveries = _b.sent();
                return [4 /*yield*/, sendLateArrivals($, state)];
            case 8:
                late = _b.sent();
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, settledHandoff.trigger), { action: 'cleared', sessionId: oldId, note: noteDelivery, clearedBy: clearedBy, compactedBeforeClear: settledHandoff.hasCompactedBeforeClear, heldFields: __assign(__assign({}, (0, decision_record_1.heldGroupFields)((0, handoff_note_1.groupHeldPrompts)(__spreadArray(__spreadArray([], settledHandoff.heldGroups, true), late.prompts, true)))), { handoff_unattended: settledHandoff.isUnattended, held_other_delivery: (0, held_delivery_1.worstDelivery)(__spreadArray(__spreadArray([], deliveries, true), late.deliveries, true)) }) }))];
            case 9:
                _b.sent();
                return [2 /*return*/];
        }
    });
}); };
var prepareHandoff = function ($, state, request) { return __awaiter(void 0, void 0, void 0, function () {
    var oldId, note, error_17;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 6, , 8]);
                return [4 /*yield*/, redrawBand($, state, band_text_1.WRITING)];
            case 1:
                _a.sent();
                $.ui.toast(band_text_1.WRITING_STATUS);
                return [4 /*yield*/, $.session.id()];
            case 2:
                // SAFETY: a session end between scheduleHandoff and this read would make oldId the new session's id. That needs a
                // /clear in the same clock.after(0) tick as /handoff, which a person typing cannot produce; SDK or bridge commands
                // sent back to back could. No guard: the note would still be delivered, but the resume line and the cleared record's
                // session_id would name the new session instead of the one the note came from.
                oldId = _a.sent();
                (0, session_state_1.beginNoteWindow)(state);
                return [4 /*yield*/, writeNote($)];
            case 3:
                note = _a.sent();
                if (!(note === null)) return [3 /*break*/, 5];
                return [4 /*yield*/, abandonHandoff($, state, settleHandoff(state, request), 'no_handoff_written', 'No handoff was written. This session is unchanged.', oldId)];
            case 4:
                _a.sent();
                return [2 /*return*/, null];
            case 5: return [2 /*return*/, { oldId: oldId, note: note }];
            case 6:
                error_17 = _a.sent();
                debug($, "handoff failed before the clear: ".concat(String(error_17)));
                return [4 /*yield*/, abandonHandoff($, state, settleHandoff(state, request), 'handoff_failed', 'No handoff was written. This session is unchanged.', oldId)];
            case 7:
                _a.sent();
                return [2 /*return*/, null];
            case 8: return [2 /*return*/];
        }
    });
}); };
// A session end already decided the outcome, so the wait is no longer about a clear the handoff will issue.
var showWaitingStatus = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (state.sessionEndBeforeClear !== null)
                    return [2 /*return*/];
                return [4 /*yield*/, redrawBand($, state, band_text_1.WAITING)];
            case 1:
                _a.sent();
                $.ui.toast(band_text_1.WAITING_STATUS);
                return [2 /*return*/];
        }
    });
}); };
// Once a session end decided the outcome, no clear will run: the wait is for delivering the note or for stopping.
var WAIT_STARTED_LINES = {
    none: 'waiting for a running turn to end before the handoff goes on',
    cleared_by_person: 'waiting for a running turn to end before delivering the note',
    other: 'waiting for a running turn to end before stopping the handoff',
};
var waitStartedLine = function (state) { var _a; return WAIT_STARTED_LINES[(_a = state.sessionEndBeforeClear) !== null && _a !== void 0 ? _a : 'none']; };
// Who ran the clear for each outcome that reaches it; a new outcome fails to compile until it is mapped here.
var CLEARED_BY = {
    clear: 'handoff',
    deliver_to_person_clear: 'person',
};
// Waits out running turns, compacts if asked, and checks for background work, then starts the clear.
// SAFETY: on the clear path, no await sits between the last isTurnRunning read and the $.command.run inside
// clearSession. Every awaited step before the clear (the waiting status, the compaction, the busy check) is followed by
// another pass through the wait, and the loop resumes straight from waitForTurnEnd, so a turn.start cannot land in the
// gap. That is why the clear starts here, in the same synchronous run as the last read, and the caller only awaits the
// promise it gets back: returning the outcome first and clearing in the caller would put an await in the gap.
// clearSession's first step is the synchronous command call. Do not add an await after the loop, or move the clear
// behind a helper that awaits first. The person-cleared branch may await in the caller: no clear runs there.
var waitForClearWindow = function ($, state, request, oldId) { return __awaiter(void 0, void 0, void 0, function () {
    var mustRefuseWhenBusy, isCompacted, isBusy, hasShownWaiting, hasCompactedBeforeClear, outcome, clearWindow;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                mustRefuseWhenBusy = request.trigger.point !== 'command';
                isCompacted = !state.compactBeforeClear;
                isBusy = false;
                hasShownWaiting = false;
                hasCompactedBeforeClear = false;
                _a.label = 1;
            case 1:
                if (!state.isTurnRunning) return [3 /*break*/, 5];
                if (!!hasShownWaiting) return [3 /*break*/, 3];
                hasShownWaiting = true;
                debug($, waitStartedLine(state));
                return [4 /*yield*/, showWaitingStatus($, state)];
            case 2:
                _a.sent();
                return [3 /*break*/, 1];
            case 3: return [4 /*yield*/, (0, session_state_1.waitForTurnEnd)(state)];
            case 4:
                _a.sent();
                debug($, 'resumed after the wait for a running turn');
                return [3 /*break*/, 1];
            case 5:
                if (state.sessionEndBeforeClear !== null)
                    return [3 /*break*/, 10];
                if (!!isCompacted) return [3 /*break*/, 7];
                isCompacted = true;
                return [4 /*yield*/, compactBeforeClearing($, state, request.trigger, oldId)];
            case 6:
                hasCompactedBeforeClear = _a.sent();
                return [3 /*break*/, 9];
            case 7:
                if (!mustRefuseWhenBusy)
                    return [3 /*break*/, 10];
                return [4 /*yield*/, isBackgroundBusy($, state)];
            case 8:
                isBusy = _a.sent();
                if (!state.isTurnRunning)
                    return [3 /*break*/, 10];
                _a.label = 9;
            case 9: return [3 /*break*/, 1];
            case 10:
                outcome = (0, session_state_1.preClearOutcome)(state.sessionEndBeforeClear, isBusy);
                clearWindow = { outcome: outcome, hasCompactedBeforeClear: hasCompactedBeforeClear, isBusy: isBusy, hasTurnAfterNote: state.hasTurnAfterNote };
                if (outcome !== 'clear')
                    return [2 /*return*/, __assign(__assign({}, clearWindow), { clearing: null })];
                (0, session_state_1.beginOwnClear)(state);
                return [2 /*return*/, __assign(__assign({}, clearWindow), { clearing: clearSession($) })];
        }
    });
}); };
var runHandoff = function ($, state, request, beforeRun) { return __awaiter(void 0, void 0, void 0, function () {
    var prepared, _a, outcome, hasCompactedBeforeClear_1, isBusy, hasTurnAfterNote, clearing, settleAfterWait, busySettled, isCleared, settledHandoff, clearedBy;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, , 15, 16]);
                // SAFETY: beforeRun is emptyBoxIfHolding, which catches its own failures, so no test can make it throw.
                // It runs inside the try so a future beforeRun that throws still releases the claim.
                return [4 /*yield*/, (beforeRun === null || beforeRun === void 0 ? void 0 : beforeRun())];
            case 1:
                // SAFETY: beforeRun is emptyBoxIfHolding, which catches its own failures, so no test can make it throw.
                // It runs inside the try so a future beforeRun that throws still releases the claim.
                _b.sent();
                return [4 /*yield*/, prepareHandoff($, state, request)];
            case 2:
                prepared = _b.sent();
                if (prepared === null)
                    return [2 /*return*/];
                return [4 /*yield*/, waitForClearWindow($, state, request, prepared.oldId)];
            case 3:
                _a = _b.sent(), outcome = _a.outcome, hasCompactedBeforeClear_1 = _a.hasCompactedBeforeClear, isBusy = _a.isBusy, hasTurnAfterNote = _a.hasTurnAfterNote, clearing = _a.clearing;
                settleAfterWait = function () { return (__assign(__assign({}, settleHandoff(state, request)), { hasCompactedBeforeClear: hasCompactedBeforeClear_1 })); };
                if (!(outcome === 'abandon_session_ended')) return [3 /*break*/, 5];
                return [4 /*yield*/, abandonHandoff($, state, settleAfterWait(), 'session_ended', (0, handoff_note_1.sessionEndedMessage)(hasCompactedBeforeClear_1, prepared.oldId), prepared.oldId)];
            case 4: return [2 /*return*/, _b.sent()];
            case 5:
                if (!(outcome === 'abandon_busy')) return [3 /*break*/, 7];
                busySettled = __assign(__assign({}, settleAfterWait()), { trigger: (0, signals_1.busyRefusalTrigger)(request.trigger) });
                return [4 /*yield*/, abandonHandoff($, state, busySettled, 'background_busy', (0, handoff_note_1.busyRefusalMessage)(hasCompactedBeforeClear_1), prepared.oldId)];
            case 6: return [2 /*return*/, _b.sent()];
            case 7:
                isCleared = true;
                if (!(clearing !== null)) return [3 /*break*/, 9];
                return [4 /*yield*/, clearing];
            case 8:
                isCleared = _b.sent();
                return [3 /*break*/, 11];
            case 9: 
            // No clear runs here, so this await is safe; the waiting status must not outlive the wait.
            // SAFETY: a resume that lands during this await gets the note in the resumed session, as one landing during
            // registerHandoffCommand already does. Each window is one engine round trip wide. No guard.
            return [4 /*yield*/, takeDownBand($, state)];
            case 10:
                // No clear runs here, so this await is safe; the waiting status must not outlive the wait.
                // SAFETY: a resume that lands during this await gets the note in the resumed session, as one landing during
                // registerHandoffCommand already does. Each window is one engine round trip wide. No guard.
                _b.sent();
                _b.label = 11;
            case 11:
                settledHandoff = settleAfterWait();
                if (!!isCleared) return [3 /*break*/, 13];
                return [4 /*yield*/, abandonHandoff($, state, settledHandoff, 'clear_failed', (0, handoff_note_1.clearFailedMessage)(hasCompactedBeforeClear_1), prepared.oldId)];
            case 12: return [2 /*return*/, _b.sent()];
            case 13:
                clearedBy = CLEARED_BY[outcome];
                return [4 /*yield*/, continueInFreshSession($, state, settledHandoff, prepared.oldId, prepared.note, hasTurnAfterNote, clearedBy)];
            case 14:
                _b.sent();
                return [3 /*break*/, 16];
            case 15:
                (0, session_state_1.endHandoff)(state);
                state.pending = null;
                return [7 /*endfinally*/];
            case 16: return [2 /*return*/];
        }
    });
}); };
var scheduleHandoff = function ($, state, request, beforeRun) {
    var _a;
    if (!(0, session_state_1.claimPending)(state, 'handoff'))
        return false;
    state.heldPrompt = null;
    (0, session_state_1.beginBeforeClear)(state);
    (0, session_state_1.beginHandoffHold)(state, request.heldPrompt === undefined
        ? null
        : { text: request.heldPrompt, isUnattended: request.isUnattended, origin: (_a = request.heldPromptOrigin) !== null && _a !== void 0 ? _a : 'composer' });
    $.clock.after(0, function () {
        void logFailure($, runHandoff($, state, request, beforeRun));
    });
    return true;
};
var evaluateTurnEnd = function ($, state, e, hasFinishedTask) { return __awaiter(void 0, void 0, void 0, function () {
    var isBusy, _a, signal, outcome, trigger;
    var _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                if (state.pending !== null)
                    return [2 /*return*/];
                (0, session_state_1.noteCacheReads)(state, (_b = e.usage) === null || _b === void 0 ? void 0 : _b.cache_read_input_tokens);
                return [4 /*yield*/, isBackgroundBusy($, state)];
            case 1:
                isBusy = _c.sent();
                _a = (0, turn_end_plan_1.planTurnEnd)({
                    contextTokens: state.contextTokens,
                    threshold: state.threshold,
                    hasFinishedTask: hasFinishedTask,
                    isBackgroundBusy: isBusy,
                    mode: state.mode,
                    isUnattended: state.isTurnUnattended,
                    backoffFrom: state.backoffFrom,
                }), signal = _a.signal, outcome = _a.outcome;
                trigger = (0, decision_record_1.snapshotTrigger)(state, 'turn-end', signal, isBusy);
                if (!(outcome.kind === 'back-off')) return [3 /*break*/, 3];
                return [4 /*yield*/, takeDownBand($, state)];
            case 2:
                _c.sent();
                return [2 /*return*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'backoff' }))];
            case 3:
                if (outcome.kind === 'advise')
                    return [2 /*return*/, offerBand($, state, trigger, outcome.holdsPrompt)];
                return [4 /*yield*/, takeDownBand($, state)];
            case 4:
                _c.sent();
                if (outcome.kind === 'compact')
                    return [2 /*return*/, scheduleCompaction($, state, trigger)];
                if (outcome.kind === 'handoff')
                    return [2 /*return*/, scheduleHandoff($, state, { trigger: trigger, isUnattended: state.isTurnUnattended })];
                return [2 /*return*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none' }))];
        }
    });
}); };
var readBranch = function ($) { return __awaiter(void 0, void 0, void 0, function () {
    var ran, error_18;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, $.process.run(['git', 'branch', '--show-current'], { timeoutMs: BRANCH_READ_TIMEOUT_MS })];
            case 1:
                ran = _a.sent();
                return [2 /*return*/, ran.exitCode === 0 ? ran.stdout.trim() : ''];
            case 2:
                error_18 = _a.sent();
                debug($, "could not read the git branch: ".concat(String(error_18)));
                return [2 /*return*/, ''];
            case 3: return [2 /*return*/];
        }
    });
}); };
var inspectPrompt = function ($, state, text) { return __awaiter(void 0, void 0, void 0, function () {
    var _i, _a, prefix, branchPrefixes, _b, _c, prefixes, isNewWork, _d, _e, ref;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                for (_i = 0, _a = (0, work_refs_1.ticketUrlPrefixes)(text); _i < _a.length; _i++) {
                    prefix = _a[_i];
                    state.urlPrefixes.add(prefix);
                }
                if (!(0, work_refs_1.hasTicketShapedToken)(text)) return [3 /*break*/, 2];
                _c = work_refs_1.branchTicketPrefixes;
                return [4 /*yield*/, readBranch($)];
            case 1:
                _b = _c.apply(void 0, [_f.sent()]);
                return [3 /*break*/, 3];
            case 2:
                _b = [];
                _f.label = 3;
            case 3:
                branchPrefixes = _b;
                prefixes = __spreadArray(__spreadArray([], state.urlPrefixes, true), branchPrefixes, true);
                isNewWork = (0, work_refs_1.namesNewWork)(text, state.seenRefs, prefixes);
                for (_d = 0, _e = (0, work_refs_1.workRefs)(text, prefixes); _d < _e.length; _d++) {
                    ref = _e[_d];
                    state.seenRefs.add(ref);
                }
                return [2 /*return*/, isNewWork];
        }
    });
}); };
var emptyBoxIfHolding = function ($, text) { return __awaiter(void 0, void 0, void 0, function () {
    var remainingDraft, _a, error_19;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 4, , 5]);
                _a = handoff_note_1.withoutPrompt;
                return [4 /*yield*/, $.prompt.read()];
            case 1:
                remainingDraft = _a.apply(void 0, [(_b.sent()).text, text]);
                if (!(remainingDraft !== null)) return [3 /*break*/, 3];
                return [4 /*yield*/, $.prompt.fill({ text: remainingDraft, mode: 'replace' })];
            case 2:
                _b.sent();
                _b.label = 3;
            case 3: return [3 /*break*/, 5];
            case 4:
                error_19 = _b.sent();
                debug($, "could not empty the prompt box: ".concat(String(error_19)));
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); };
var refillHeldPrompt = function ($, state, text) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (state.heldPrompt !== text)
                    return [2 /*return*/];
                return [4 /*yield*/, refillBox($, text)];
            case 1:
                if (_a.sent())
                    return [2 /*return*/];
                if (state.heldPrompt !== text)
                    return [2 /*return*/];
                state.heldPrompt = null;
                return [4 /*yield*/, takeDownBand($, state)];
            case 2:
                _a.sent();
                return [4 /*yield*/, submitOrKeepInTranscript($, state, composerPrompt(text))];
            case 3:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
var holdPrompt = function ($, state, text, trigger) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                state.heldPrompt = text;
                $.clock.after(0, function () {
                    void logFailure($, refillHeldPrompt($, state, text));
                });
                return [4 /*yield*/, offerBand($, state, trigger, true)];
            case 1:
                _a.sent();
                return [2 /*return*/, { drop: HELD_PROMPT }];
        }
    });
}); };
// -- Prompts held while a handoff is pending. Kept together so the whole rule can move out of this file as one piece.
var returnToBox = function ($, text, placement) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, refillBox($, text, placement)];
            case 1:
                if (!(_a.sent()))
                    keepInTranscript($, composerPrompt(text));
                return [2 /*return*/];
        }
    });
}); };
// An attachment or context can't be resent, so the prompt is handed back instead. A person at this terminal gets it in the
// box to send again. For any other sender the box is not where they are, and filling it could displace the draft of the
// person who is: the engine has no channel back to the sender beyond the drop reason, so the text goes in the transcript.
var handBackRefused = function ($, e, placement) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        if ((0, prompt_plan_1.isComposerOrigin)(e.origin.kind))
            return [2 /*return*/, returnToBox($, e.text, placement)];
        $.ui.log(keptRefusedPrompt(e.origin.kind, e.text));
        return [2 /*return*/];
    });
}); };
// The placement is read now: by the time the clock fires, the delivery may be over.
var refuseDuringHandoff = function ($, state, e) {
    var placement = (0, session_state_1.refusedPromptPlacement)(state.handoffHold);
    debug($, 'refused a prompt with attachments or context during the handoff');
    $.ui.toast(REFUSED_TOAST);
    $.clock.after(0, function () {
        void logFailure($, handBackRefused($, e, placement));
    });
    return { drop: REFUSED_DURING_HANDOFF };
};
var holdForHandoff = function ($, state, e) {
    var heldCount = (0, session_state_1.addHeldPrompt)(state, { text: e.text, isUnattended: (0, prompt_plan_1.isUnattendedOrigin)(e.origin.kind), origin: e.origin.kind });
    debug($, "held a prompt for the handoff (".concat(heldCount, " held)"));
    return { drop: HELD_FOR_HANDOFF };
};
// Taking the held prompts ends their holding: from here a prompt that arrives belongs to the fresh session or the old one.
var settleHandoff = function (state, request) { return ({
    trigger: request.trigger,
    isUnattended: request.isUnattended,
    heldGroups: (0, handoff_note_1.groupHeldPrompts)((0, session_state_1.takeHeldPrompts)(state)),
}); };
var decideDuringHandoff = function ($, state, e) {
    var action = (0, prompt_plan_1.planPromptDuringHandoff)({
        isCarried: (0, session_state_1.isCarriedByHandoff)(state, e.text),
        isHolding: (0, session_state_1.isHoldingForHandoff)(state),
        hasExtras: (0, prompt_plan_1.carriesExtras)(e),
    });
    // The handoff already carries this text and sends or restores it itself, so a repeat of it would run twice.
    if (action === 'drop-repeat') {
        debug($, 'dropped a repeat of the prompt the handoff carries');
        return { drop: REPEAT_NOT_ADDED };
    }
    if (action === 'refuse')
        return refuseDuringHandoff($, state, e);
    if (action === 'hold')
        return holdForHandoff($, state, e);
    return undefined;
};
var decidePrompt = function ($, state, e) { return __awaiter(void 0, void 0, void 0, function () {
    var duringHandoff, isUnattended, isNewWork, canHold, isBusy, _a, signal, action, trigger, isClaimed;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                duringHandoff = decideDuringHandoff($, state, e);
                if (duringHandoff !== undefined)
                    return [2 /*return*/, duringHandoff];
                isUnattended = (0, prompt_plan_1.isUnattendedOrigin)(e.origin.kind);
                state.heldPrompt = null;
                state.isTurnUnattended = isUnattended;
                return [4 /*yield*/, inspectPrompt($, state, e.text)];
            case 1:
                isNewWork = _b.sent();
                canHold = (0, prompt_plan_1.canHoldPrompt)({
                    isNewWork: isNewWork,
                    hasPendingAction: state.pending !== null,
                    hasTurnId: e.turnId !== undefined,
                    hasExtras: (0, prompt_plan_1.carriesExtras)(e),
                });
                if (!canHold)
                    return [2 /*return*/, null];
                return [4 /*yield*/, isBackgroundBusy($, state)];
            case 2:
                isBusy = _b.sent();
                _a = (0, prompt_plan_1.planNewWorkPrompt)({
                    contextTokens: state.contextTokens,
                    threshold: state.threshold,
                    isBackgroundBusy: isBusy,
                    mode: state.mode,
                    isUnattended: isUnattended,
                    isFromComposer: (0, prompt_plan_1.isComposerOrigin)(e.origin.kind),
                }), signal = _a.signal, action = _a.action;
                trigger = (0, decision_record_1.snapshotTrigger)(state, 'prompt', signal, isBusy);
                if (action === 'handoff') {
                    isClaimed = scheduleHandoff($, state, { trigger: trigger, heldPrompt: e.text, heldPromptOrigin: e.origin.kind, isUnattended: isUnattended });
                    return [2 /*return*/, isClaimed ? { drop: HANDING_OFF_FIRST } : null];
                }
                if (action === 'hold')
                    return [2 /*return*/, holdPrompt($, state, e.text, trigger)];
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none' }))];
            case 3:
                _b.sent();
                return [2 /*return*/, null];
        }
    });
}); };
var pressHeldPromptButton = function ($, state, trigger, button) { return __awaiter(void 0, void 0, void 0, function () {
    var heldPrompt;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                heldPrompt = state.heldPrompt;
                if (heldPrompt === null) {
                    debug($, "dropped a ".concat(button, " press: no prompt is held"));
                    $.ui.toast(PROMPT_NOT_HELD);
                    return [2 /*return*/, takeDownBand($, state)];
                }
                state.heldPrompt = null;
                return [4 /*yield*/, takeDownBand($, state)];
            case 1:
                _a.sent();
                return [4 /*yield*/, emptyBoxIfHolding($, heldPrompt)];
            case 2:
                _a.sent();
                if (button === 'handoff-send' && scheduleHandoff($, state, { trigger: trigger, heldPrompt: heldPrompt, isUnattended: false }))
                    return [2 /*return*/];
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'send_here' }))];
            case 3:
                _a.sent();
                $.clock.after(0, function () {
                    void logFailure($, sendOrKeepInBox($, state, composerPrompt(heldPrompt)));
                });
                return [2 /*return*/];
        }
    });
}); };
var redrawBand = function ($, state, band) { return __awaiter(void 0, void 0, void 0, function () {
    var error_20;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, (0, claude_code_1.update)($, offerAtom, function () { return band; })];
            case 1:
                _a.sent();
                state.hasBand = true;
                return [3 /*break*/, 3];
            case 2:
                error_20 = _a.sent();
                debug($, "could not redraw the band: ".concat(String(error_20)));
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); };
// Only the band the press was made on may be redrawn: one taken down or replaced since stays as it is.
var redrawIfStillShown = function ($, state, shown, redrawn) { return __awaiter(void 0, void 0, void 0, function () {
    var current, error_21;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 4, , 5]);
                return [4 /*yield*/, (0, claude_code_1.read)($, offerAtom)];
            case 1:
                current = _a.sent();
                if (!(current !== null && (0, band_text_1.isSameOffer)(current, shown))) return [3 /*break*/, 3];
                return [4 /*yield*/, redrawBand($, state, redrawn)];
            case 2:
                _a.sent();
                _a.label = 3;
            case 3: return [3 /*break*/, 5];
            case 4:
                error_21 = _a.sent();
                debug($, "could not read the band: ".concat(String(error_21)));
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); };
var refuseToClear = function ($, state, offer, trigger) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                $.ui.toast((0, handoff_note_1.busyRefusalMessage)(false));
                return [4 /*yield*/, redrawIfStillShown($, state, offer, (0, band_text_1.offerWithBusyState)(offer, state.contextTokens, true))];
            case 1:
                _a.sent();
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, (0, signals_1.busyRefusalTrigger)(trigger)), { action: 'none', reason: 'background_busy' }))];
            case 2:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
// Busyness is read when the press runs, not taken from the offer: a shell may have started since the band was drawn.
var runPress = function ($_1, state_1, _a) { return __awaiter(void 0, [$_1, state_1, _a], void 0, function ($, state, _b) {
    var isBusy, trigger;
    var offer = _b.offer, button = _b.button;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0: return [4 /*yield*/, isBackgroundBusy($, state)];
            case 1:
                isBusy = _c.sent();
                if (state.pending !== null) {
                    debug($, "dropped a ".concat(button, " press: a ").concat(state.pending, " is already pending"));
                    return [2 /*return*/, $.ui.toast(ALREADY_PENDING)];
                }
                trigger = (0, decision_record_1.snapshotTrigger)(state, 'button', offer.signal, isBusy);
                if (isBusy && (0, band_text_1.clearsSession)(button))
                    return [2 /*return*/, refuseToClear($, state, offer, trigger)];
                if (button === 'handoff-send' || button === 'send-here')
                    return [2 /*return*/, pressHeldPromptButton($, state, trigger, button)];
                if (button === 'not-now')
                    state.backoffFrom = state.contextTokens;
                else if (button === 'compact')
                    scheduleCompaction($, state, trigger);
                else
                    return [2 /*return*/, void scheduleHandoff($, state, { trigger: trigger, isUnattended: false })];
                return [4 /*yield*/, takeDownBand($, state)];
            case 2:
                _c.sent();
                if (!(button === 'not-now')) return [3 /*break*/, 4];
                return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, trigger), { action: 'none', reason: 'not_now' }))];
            case 3:
                _c.sent();
                _c.label = 4;
            case 4: return [2 /*return*/];
        }
    });
}); };
// runPress awaits the busy check before it claims anything, so the press is marked in flight in the same tick:
// a second press, Not now included, is dropped until this one settles.
var claimAndRunPress = function ($, state, press) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                state.isPressRunning = true;
                _a.label = 1;
            case 1:
                _a.trys.push([1, , 3, 4]);
                return [4 /*yield*/, runPress($, state, press)];
            case 2:
                _a.sent();
                return [3 /*break*/, 4];
            case 3:
                state.isPressRunning = false;
                return [7 /*endfinally*/];
            case 4: return [2 /*return*/];
        }
    });
}); };
// A press that clears or compacts made mid-turn waits, so /clear and compaction never land inside a turn. The first
// press wins; the band stays up until it runs, and it runs at the end of that turn in place of a fresh evaluation.
// Not now has no such hazard, so it runs at once.
var pressButton = function ($, state, offer, button) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        if (state.pending !== null || state.deferredPress !== null || state.isPressRunning) {
            return [2 /*return*/, debug($, "dropped a ".concat(button, " press: another press or a handoff or compaction comes first"))];
        }
        if (!state.isTurnRunning || button === 'not-now')
            return [2 /*return*/, claimAndRunPress($, state, { offer: offer, button: button })];
        state.deferredPress = { offer: offer, button: button };
        $.ui.toast(PRESS_WAITS_FOR_TURN);
        return [2 /*return*/];
    });
}); };
// A turn that ends without an answer gets no evaluation, so a band left up could still offer a handoff over work
// that started during it.
var refreshBandBusyState = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    var offer, isBusy, error_22;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 5, , 6]);
                return [4 /*yield*/, (0, claude_code_1.read)($, offerAtom)];
            case 1:
                offer = _a.sent();
                if (offer === null || (0, band_text_1.isWriting)(offer))
                    return [2 /*return*/];
                return [4 /*yield*/, isBackgroundBusy($, state)];
            case 2:
                isBusy = _a.sent();
                if (!(offer.isBusy !== isBusy)) return [3 /*break*/, 4];
                return [4 /*yield*/, redrawBand($, state, (0, band_text_1.offerWithBusyState)(offer, state.contextTokens, isBusy))];
            case 3:
                _a.sent();
                _a.label = 4;
            case 4: return [3 /*break*/, 6];
            case 5:
                error_22 = _a.sent();
                debug($, "could not read the band: ".concat(String(error_22)));
                return [3 /*break*/, 6];
            case 6: return [2 /*return*/];
        }
    });
}); };
var drawWritingStatus = function ($, e, band) {
    var _a = $.ui.resolve(e), Box = _a.Box, Text = _a.Text;
    return (<Box flexDirection="column" backgroundColor="subtle">
      <Text>{(0, band_text_1.statusText)(band)}</Text>
    </Box>);
};
var drawBand = function ($, state, e, offer) {
    var _a = $.ui.resolve(e), Box = _a.Box, Text = _a.Text, Button = _a.Button;
    return (<Box flexDirection="column" backgroundColor="subtle">
      <Text>{(0, band_text_1.bandMessage)(offer)}</Text>
      <Box flexWrap="wrap" columnGap={2}>
        {(0, band_text_1.bandControls)((0, signals_1.bandButtons)(offer)).map(function (_a) {
            var button = _a.button, hotkey = _a.hotkey, isPrimary = _a.isPrimary, isDismiss = _a.isDismiss;
            return (<Button key={button} label={band_text_1.BUTTON_LABELS[button]} hotkey={hotkey} plain {...(isPrimary ? { variant: 'primary', autoFocus: true } : {})} {...(isDismiss ? { role: 'dismiss' } : {})} onPress={function () { return logFailure($, pressButton($, state, offer, button)); }}/>);
        })}
      </Box>
      <Text dimColor>{(0, band_text_1.bandHint)(offer)}</Text>
    </Box>);
};
var startHandoffCommand = function ($, state) { return __awaiter(void 0, void 0, void 0, function () {
    var trigger, _a, _b, heldPrompt, emptyBox, isClaimed;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _a = decision_record_1.snapshotTrigger;
                _b = [state, 'command', 'none'];
                return [4 /*yield*/, isBackgroundBusy($, state)];
            case 1:
                trigger = _a.apply(void 0, _b.concat([_c.sent()]));
                heldPrompt = state.heldPrompt;
                emptyBox = heldPrompt === null ? undefined : function () { return emptyBoxIfHolding($, heldPrompt); };
                isClaimed = scheduleHandoff($, state, __assign(__assign({ trigger: trigger }, (heldPrompt === null ? {} : { heldPrompt: heldPrompt })), { isUnattended: false }), emptyBox);
                return [2 /*return*/, { text: isClaimed ? WRITING_COMMAND_REPLY : ALREADY_PENDING }];
        }
    });
}); };
var register = function (on, options) {
    var setting = (0, signals_1.asMode)(options.handoffMode);
    // SAFETY: a hot reload (a code change under --plugin-dir watch, or a setting changed in /config) runs register again, and
    // the new state starts with pending null and nothing held. A handoff already running keeps the old state and its old
    // closures. Its prompts are no longer held, so they pass through and /clear can land inside their turn. The old hooks are
    // gone too, so nothing releases a wait for a turn to end, and that handoff waits forever and never clears. Both need a
    // reload while a handoff runs, from the note being written until its prompts are delivered. No guard: carrying the state
    // across a reload would need it in an atom. After a reload, run /handoff again.
    var state = (0, session_state_1.createState)({
        setting: setting,
        threshold: (0, signals_1.asThreshold)(options.handoffContextTokens),
        compactBeforeClear: options.compactBeforeClear === true,
    });
    on('session.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var started, _a, engineVersion, base, isUntested;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    started = _b.sent();
                    return [4 /*yield*/, takeDownBandFromBeforeReload($, state)];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, readVersion($)];
                case 3:
                    _a = _b.sent(), engineVersion = _a.engineVersion, base = _a.base;
                    isUntested = (0, engine_version_1.isUntestedEngine)(base);
                    state.engineVersion = engineVersion;
                    state.mode = e.isInteractive && !isUntested ? setting : 'off';
                    if (!e.isInteractive) return [3 /*break*/, 5];
                    return [4 /*yield*/, registerHandoffCommand($)];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5:
                    if (!isUntested) return [3 /*break*/, 7];
                    // In the transcript as well as the toast: a toast can be gone before a screen reader reads it.
                    if (setting !== 'off')
                        announce($, untestedEngineNotice(engineVersion, e.isInteractive));
                    return [4 /*yield*/, writeRecord($, state, __assign(__assign({}, (0, decision_record_1.snapshotTrigger)(state, 'session-start', 'none', false)), { action: 'untested_engine' }))];
                case 6:
                    _b.sent();
                    _b.label = 7;
                case 7: return [2 /*return*/, started];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
    on('turn.step', function ($, e, next) {
        return __asyncGenerator(this, arguments, function () {
            var step, reported;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [5 /*yield**/, __values(__asyncDelegator(__asyncValues(next(e))))];
                    case 1: return [4 /*yield*/, __await.apply(void 0, [_b.sent()])];
                    case 2:
                        step = _b.sent();
                        if (!(e.agentId === undefined && step.usage)) return [3 /*break*/, 4];
                        return [4 /*yield*/, __await(reportedContext($))];
                    case 3:
                        reported = _b.sent();
                        state.contextTokens = (0, signals_1.contextFromStep)({
                            input: step.usage.input_tokens,
                            created: step.usage.cache_creation_input_tokens,
                            read: step.usage.cache_read_input_tokens,
                            advisorCalls: ((_a = step.serverToolUses) !== null && _a !== void 0 ? _a : []).filter(function (use) { return use.name === 'advisor'; }).length,
                            reported: reported,
                        });
                        _b.label = 4;
                    case 4: return [4 /*yield*/, __await(step)];
                    case 5: return [2 /*return*/, _b.sent()];
                }
            });
        });
    }).catch(function ($, e, next) {
        return __asyncGenerator(this, arguments, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [5 /*yield**/, __values(__asyncDelegator(__asyncValues(next(e))))];
                    case 1: return [4 /*yield*/, __await.apply(void 0, [_a.sent()])];
                    case 2: return [4 /*yield*/, __await.apply(void 0, [_a.sent()])];
                    case 3: return [2 /*return*/, _a.sent()];
                }
            });
        });
    });
    // next<string> skips inferring the tool name from every MCP tool in the types file, which made tsc time grow with the connected servers.
    on('tool.call', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var ran;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    ran = _a.sent();
                    if (e.agentId === undefined)
                        (0, tool_call_tracking_1.noteToolCall)(state, e, ran);
                    return [2 /*return*/, ran];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
    on('prompt.submit', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var finishedTaskId, dropped, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(state.heldPrompt !== null && (0, prompt_plan_1.isPersonOrigin)(e.origin.kind))) return [3 /*break*/, 2];
                    return [4 /*yield*/, takeDownBand($, state)];
                case 1:
                    _b.sent();
                    _b.label = 2;
                case 2:
                    finishedTaskId = e.origin.kind === 'task-notification' ? (0, tasks_1.notifiedTaskId)(e.text) : null;
                    if (finishedTaskId !== null)
                        state.backgroundTasks.delete(finishedTaskId);
                    if (!(0, prompt_plan_1.isPersonOrigin)(e.origin.kind)) return [3 /*break*/, 4];
                    return [4 /*yield*/, decidePrompt($, state, e)];
                case 3:
                    _a = _b.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _a = null;
                    _b.label = 5;
                case 5:
                    dropped = _a;
                    return [2 /*return*/, dropped !== null && dropped !== void 0 ? dropped : next(e)];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
    on('turn.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            (0, session_state_1.startMainTurn)(state, e.text);
            return [2 /*return*/, next(e)];
        });
    }); }).catch(function ($, e, next) { return next(e); });
    on('turn.complete', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var result, hasFinishedTask, deferredPress;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    result = _b.sent();
                    if (e.agentId !== undefined)
                        return [2 /*return*/, result];
                    hasFinishedTask = state.hasFinishedTask;
                    state.hasFinishedTask = false;
                    (0, session_state_1.endMainTurn)(state);
                    deferredPress = state.deferredPress;
                    state.deferredPress = null;
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, , 9, 10]);
                    if (!(deferredPress !== null)) return [3 /*break*/, 4];
                    (0, session_state_1.noteCacheReads)(state, (_a = e.usage) === null || _a === void 0 ? void 0 : _a.cache_read_input_tokens);
                    return [4 /*yield*/, claimAndRunPress($, state, deferredPress)];
                case 3:
                    _b.sent();
                    return [3 /*break*/, 8];
                case 4:
                    if (!(e.reason === 'answer')) return [3 /*break*/, 6];
                    return [4 /*yield*/, evaluateTurnEnd($, state, e, hasFinishedTask)];
                case 5:
                    _b.sent();
                    return [3 /*break*/, 8];
                case 6: return [4 /*yield*/, refreshBandBusyState($, state)];
                case 7:
                    _b.sent();
                    _b.label = 8;
                case 8: return [3 /*break*/, 10];
                case 9:
                    // The handoff clears in a later tick: /clear inside the hook the turn is waiting on is refused.
                    // SAFETY: every call in the try block catches its own engine failures (isBackgroundBusy, takeDownBand, writeRecord,
                    // offerBand, refreshBandBusyState), and the toast and log calls return void, so the kit cannot make the block throw
                    // and no test reaches this finally on a throw. Keep it: it is the only thing that frees a waiting handoff if a
                    // future call in the block forgets to catch.
                    $.clock.after(0, function () { return (0, session_state_1.releaseTurnEndWaiter)(state); });
                    return [7 /*endfinally*/];
                case 10: return [2 /*return*/, result];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
    on('ui.render', { component: 'AbovePrompt' }, function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var offer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, claude_code_1.read)($, offerAtom)];
                case 1:
                    offer = _a.sent();
                    if (e.props.hasSurvey || offer === null)
                        return [2 /*return*/, next(e)];
                    return [2 /*return*/, (0, band_text_1.isWriting)(offer) ? drawWritingStatus($, e, offer) : drawBand($, state, e, offer)];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
    // SAFETY: startHandoffCommand's only await is isBackgroundBusy, which catches its own failures, so no test reaches this catch.
    // Keep it: every hook must never break a turn.
    on('command.run', { command: 'handoff' }, function ($) { return startHandoffCommand($, state); }).catch(function () { return ({
        text: 'Could not start a handoff.',
    }); });
    on('session.end', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    (0, session_state_1.recordSessionEnd)(state, e.reason);
                    return [4 /*yield*/, takeDownBand($, state)];
                case 1:
                    _a.sent();
                    (0, session_state_1.resetForNewSession)(state);
                    // A handoff waiting on a turn resumes in a later tick, so it never runs inside this hook.
                    $.clock.after(0, function () { return (0, session_state_1.releaseTurnEndWaiter)(state); });
                    if (e.reason === 'clear') {
                        $.clock.after(0, function () {
                            void logFailure($, registerHandoffCommand($));
                        });
                    }
                    return [2 /*return*/, next(e)];
            }
        });
    }); }).catch(function ($, e, next) { return next(e); });
};
exports.register = register;
