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
exports.withoutPrompt = exports.holdsPrompt = exports.groupsLeftToSend = exports.groupJoiningNote = exports.groupHeldPrompts = exports.joinPrompts = exports.FINAL_MESSAGES = exports.noteNotCarriedMessage = exports.noteInBoxMessage = exports.handedOffMessage = exports.resumeCommand = exports.busyRefusalMessage = exports.clearFailedMessage = exports.sessionEndedMessage = exports.handoffMessage = exports.turnAfterNoteLine = exports.HANDOFF_PROMPT = void 0;
var prompt_plan_1 = require("./prompt-plan");
var session_state_1 = require("./session-state");
exports.HANDOFF_PROMPT = "Write a handoff for the next session, which will start fresh with only this note.\nCover, under short headings:\n- The task and its goal.\n- What is done: commits, branches, PRs, and files, with paths.\n- Decisions made, and why.\n- Open threads.\n- The next concrete step.\n- Facts the next session would otherwise rediscover.\nUse plain Markdown, at most 400 words, and no preamble.";
var turnAfterNoteLine = function (oldSessionId) {
    return "A turn ran in the previous session while or after this note was written, so the note may not cover it. To see that turn: ".concat((0, exports.resumeCommand)(oldSessionId));
};
exports.turnAfterNoteLine = turnAfterNoteLine;
var handoffMessage = function (oldSessionId, note, hasTurnAfterNote) {
    var message = "Handoff from the previous session (".concat(oldSessionId, "), written by Claude just before a /clear:\n\n").concat(note);
    return hasTurnAfterNote ? "".concat(message, "\n\n").concat((0, exports.turnAfterNoteLine)(oldSessionId)) : message;
};
exports.handoffMessage = handoffMessage;
// One wording for the session's state in every message that stops a handoff, so each outcome reads the same.
var COMPACTED_NOT_CLEARED = 'This session was compacted, not cleared.';
var sessionLeftLine = function (hasCompacted) { return (hasCompacted ? COMPACTED_NOT_CLEARED : 'This session is unchanged.'); };
// The session that ended is the one that was compacted; the session the person sees now never was.
var sessionEndedMessage = function (hasCompacted, oldSessionId) {
    var message = 'The session ended before the handoff could clear, so it stopped. No note was carried over.';
    return hasCompacted ? "".concat(message, " The previous session was compacted. To reopen it: ").concat((0, exports.resumeCommand)(oldSessionId)) : message;
};
exports.sessionEndedMessage = sessionEndedMessage;
var clearFailedMessage = function (hasCompacted) {
    return "The handoff was written but /clear failed. ".concat(sessionLeftLine(hasCompacted), " Type /handoff to try again.");
};
exports.clearFailedMessage = clearFailedMessage;
var busyRefusalMessage = function (hasCompacted) {
    return "Background work is running, and a handoff would cut it off. ".concat(sessionLeftLine(hasCompacted), " Type /handoff to hand off anyway.");
};
exports.busyRefusalMessage = busyRefusalMessage;
var resumeCommand = function (sessionId) { return "claude --resume ".concat(sessionId); };
exports.resumeCommand = resumeCommand;
var handedOffMessage = function (oldSessionId) {
    return "Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: ".concat((0, exports.resumeCommand)(oldSessionId));
};
exports.handedOffMessage = handedOffMessage;
var noteInBoxMessage = function (oldSessionId) {
    return "Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: ".concat((0, exports.resumeCommand)(oldSessionId));
};
exports.noteInBoxMessage = noteInBoxMessage;
var noteNotCarriedMessage = function (oldSessionId) {
    return "The handoff note could not be added to this session. To reopen the full previous conversation: ".concat((0, exports.resumeCommand)(oldSessionId));
};
exports.noteNotCarriedMessage = noteNotCarriedMessage;
exports.FINAL_MESSAGES = {
    appended: exports.handedOffMessage,
    submitted: exports.handedOffMessage,
    in_box: exports.noteInBoxMessage,
    not_carried: exports.noteNotCarriedMessage,
};
var PROMPT_SEPARATOR = '\n\n';
var joinPrompts = function (handoff, heldPrompts) {
    return heldPrompts ? "".concat(handoff).concat(PROMPT_SEPARATOR).concat(heldPrompts) : handoff;
};
exports.joinPrompts = joinPrompts;
// A group is the composer's only while every prompt in it is; one remote prompt keeps the whole group out of the box, because
// the box is where the person at this terminal reviews what they typed.
var groupOrigin = function (groupSoFar, joining) { return ((0, prompt_plan_1.isComposerOrigin)(groupSoFar) ? joining : groupSoFar); };
// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
var groupHeldPrompts = function (prompts) {
    var groups = [];
    var _loop_1 = function (text, isUnattended, origin_1) {
        var index = groups.findIndex(function (group) { return (0, session_state_1.isGroupOfOrigin)(group, isUnattended); });
        var group = groups[index];
        if (group === undefined)
            groups.push({ text: text, isUnattended: isUnattended, origin: origin_1 });
        else
            groups[index] = { text: "".concat(group.text).concat(PROMPT_SEPARATOR).concat(text), isUnattended: isUnattended, origin: groupOrigin(group.origin, origin_1) };
    };
    for (var _i = 0, prompts_1 = prompts; _i < prompts_1.length; _i++) {
        var _a = prompts_1[_i], text = _a.text, isUnattended = _a.isUnattended, origin_1 = _a.origin;
        _loop_1(text, isUnattended, origin_1);
    }
    return groups;
};
exports.groupHeldPrompts = groupHeldPrompts;
// The note rides with the group that shares the handoff's own origin.
var groupJoiningNote = function (groups, handoffIsUnattended) {
    return groups.find(function (group) { return (0, session_state_1.isGroupOfOrigin)(group, handoffIsUnattended); });
};
exports.groupJoiningNote = groupJoiningNote;
// A note that was appended to the session leaves every group to send; a note that was sent as a prompt already carried its group.
var groupsLeftToSend = function (groups, handoffIsUnattended, noteDelivery) {
    return noteDelivery === 'appended' ? __spreadArray([], groups, true) : groups.filter(function (group) { return !(0, session_state_1.isGroupOfOrigin)(group, handoffIsUnattended); });
};
exports.groupsLeftToSend = groupsLeftToSend;
var holdsPrompt = function (draft, prompt) { return "\n".concat(draft, "\n").includes("\n".concat(prompt, "\n")); };
exports.holdsPrompt = holdsPrompt;
var withoutPrompt = function (draft, prompt) {
    var padded = "\n".concat(draft, "\n");
    var promptStart = padded.indexOf("\n".concat(prompt, "\n"));
    if (promptStart === -1)
        return null;
    return "".concat(padded.slice(0, promptStart)).concat(padded.slice(promptStart + prompt.length + 1)).slice(1, -1);
};
exports.withoutPrompt = withoutPrompt;
