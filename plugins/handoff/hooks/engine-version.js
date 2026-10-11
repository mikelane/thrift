"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUntestedEngine = exports.TESTED_THROUGH = void 0;
exports.TESTED_THROUGH = '2.1.295';
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var core = function (version) {
    var match = RELEASE.exec(version);
    return match ? match.slice(1).map(Number) : null;
};
var isNewer = function (candidate, reference) {
    return candidate.map(function (part, index) { return Math.sign(part - Number(reference[index])); }).find(function (order) { return order !== 0; }) === 1;
};
var isUntestedEngine = function (base, testedThrough) {
    if (testedThrough === void 0) { testedThrough = exports.TESTED_THROUGH; }
    var release = base === undefined ? null : core(base);
    var tested = core(testedThrough);
    return release === null || tested === null || isNewer(release, tested);
};
exports.isUntestedEngine = isUntestedEngine;
