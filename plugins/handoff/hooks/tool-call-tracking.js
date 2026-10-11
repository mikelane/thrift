"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteToolCall = void 0;
var command_parse_1 = require("./command-parse");
var tasks_1 = require("./tasks");
var noteToolCall = function (state, call, ran) {
    var _a;
    var didSucceed = ran.deny === undefined && ran.isError !== true;
    if (call.tool === 'Bash') {
        var started = (0, tasks_1.validTaskId)((0, tasks_1.fieldOf)(ran.result, 'backgroundTaskId'));
        if (started !== null)
            state.backgroundTasks.add(started);
        else if (didSucceed && typeof call.command === 'string' && (0, command_parse_1.finishesTask)(call.command))
            state.hasFinishedTask = true;
    }
    else if (call.tool === 'Monitor') {
        var started = (0, tasks_1.validTaskId)((0, tasks_1.fieldOf)(ran.result, 'taskId'));
        if (started !== null)
            state.backgroundTasks.add(started);
    }
    else if (ran.deny === undefined && (call.tool === 'TaskStop' || call.tool === 'KillShell')) {
        var stopped = (0, tasks_1.validTaskId)((_a = call.task_id) !== null && _a !== void 0 ? _a : call.shell_id);
        if (stopped !== null)
            state.backgroundTasks.delete(stopped);
    }
};
exports.noteToolCall = noteToolCall;
