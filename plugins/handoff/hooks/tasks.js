"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifiedTaskId = exports.fieldOf = exports.validTaskId = void 0;
var TASK_ID = /^[A-Za-z0-9_-]+$/;
var NOTIFIED_TASK = /<task-id>([^<]*)<\/task-id>/;
var validTaskId = function (value) {
    return typeof value === 'string' && TASK_ID.test(value) ? value : null;
};
exports.validTaskId = validTaskId;
var fieldOf = function (value, key) {
    return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
};
exports.fieldOf = fieldOf;
var notifiedTaskId = function (promptText) { var _a; return (0, exports.validTaskId)((_a = NOTIFIED_TASK.exec(promptText)) === null || _a === void 0 ? void 0 : _a[1]); };
exports.notifiedTaskId = notifiedTaskId;
