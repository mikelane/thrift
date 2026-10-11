"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worstDelivery = void 0;
// Worst first, so the first entry that any group had is the worst outcome among the groups.
var FROM_WORST_TO_BEST = ['not_carried', 'in_box', 'submitted'];
// Fails to compile when Carried gains an outcome the order above leaves out.
var ranksEveryOutcome = true;
var worstDelivery = function (outcomes) { var _a; return (_a = FROM_WORST_TO_BEST.find(function (outcome) { return outcomes.includes(outcome); })) !== null && _a !== void 0 ? _a : 'none'; };
exports.worstDelivery = worstDelivery;
