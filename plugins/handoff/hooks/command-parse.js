"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishesTask = exports.commandSegments = void 0;
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var MESSAGE_FLAG = /^(?:-[A-Za-z]*m|--message)$/;
var DRY_RUN_SHORT_FLAG = /^-[A-Za-z]*n[A-Za-z]*$/;
var HEREDOC_WORD_END = /[\s;|&<>()]/;
var SEPARATORS = new Set([';', '|', '&']);
var readHeredoc = function (command, start) {
    var index = start + 2;
    var stripsTabs = command[index] === '-';
    if (stripsTabs)
        index += 1;
    while (command[index] === ' ' || command[index] === '\t')
        index += 1;
    var quote = command[index] === "'" || command[index] === '"' ? command[index] : null;
    if (quote)
        index += 1;
    var word = '';
    while (index < command.length) {
        var char = command.charAt(index);
        if (quote ? char === quote : HEREDOC_WORD_END.test(char))
            break;
        word += char;
        index += 1;
    }
    if (word === '')
        return null;
    return { heredoc: { word: word, stripsTabs: stripsTabs }, end: quote ? index + 1 : index };
};
var skipHeredocBody = function (command, start, heredoc) {
    var index = start;
    while (index < command.length) {
        var lineEnd = command.indexOf('\n', index);
        var end = lineEnd === -1 ? command.length : lineEnd;
        var line = command.slice(index, end);
        index = end + 1;
        if ((heredoc.stripsTabs ? line.replace(/^\t+/, '') : line) === heredoc.word)
            break;
    }
    return Math.min(index, command.length);
};
var commandSegments = function (command) {
    var segments = [];
    var pending = [];
    var current = '';
    var quote = null;
    var index = 0;
    var endSegment = function () {
        if (current.trim() !== '')
            segments.push(current.trim());
        current = '';
    };
    var isWordStart = function () { return index === 0 || /\s/.test(command.charAt(index - 1)) || SEPARATORS.has(command.charAt(index - 1)); };
    while (index < command.length) {
        var char = command.charAt(index);
        var next = command[index + 1];
        if (quote === "'" || (quote === '"' && char !== '\\')) {
            current += char;
            if (char === quote)
                quote = null;
            index += 1;
        }
        else if (char === '\\' && next === '\n') {
            index += 2;
        }
        else if (char === '\\' && next !== undefined) {
            current += char + next;
            index += 2;
        }
        else if (quote) {
            current += char;
            index += 1;
        }
        else if (char === "'" || char === '"') {
            quote = char;
            current += char;
            index += 1;
        }
        else if (char === '#' && isWordStart()) {
            while (index < command.length && command[index] !== '\n')
                index += 1;
        }
        else if (char === '\n') {
            endSegment();
            index += 1;
            for (var _i = 0, _a = pending.splice(0); _i < _a.length; _i++) {
                var heredoc = _a[_i];
                index = skipHeredocBody(command, index, heredoc);
            }
        }
        else if (SEPARATORS.has(char)) {
            endSegment();
            index += 1;
        }
        else if (command.startsWith('<<', index)) {
            var opened = readHeredoc(command, index);
            if (opened) {
                pending.push(opened.heredoc);
                current += command.slice(index, opened.end);
                index = opened.end;
            }
            else {
                current += '<<';
                index += 2;
            }
        }
        else {
            current += char;
            index += 1;
        }
    }
    endSegment();
    return segments;
};
exports.commandSegments = commandSegments;
var shellWords = function (segment) {
    var parsedWords = [];
    var word = '';
    var hasWord = false;
    var quote = null;
    for (var index = 0; index < segment.length; index += 1) {
        var char = segment.charAt(index);
        if (quote === "'") {
            if (char === "'")
                quote = null;
            else
                word += char;
        }
        else if (char === '\\' && index + 1 < segment.length) {
            index += 1;
            word += segment.charAt(index);
            hasWord = true;
        }
        else if (quote === '"') {
            if (char === '"')
                quote = null;
            else
                word += char;
        }
        else if (char === "'" || char === '"') {
            quote = char;
            hasWord = true;
        }
        else if (/\s/.test(char)) {
            if (hasWord)
                parsedWords.push(word);
            word = '';
            hasWord = false;
        }
        else {
            word += char;
            hasWord = true;
        }
    }
    if (hasWord)
        parsedWords.push(word);
    return parsedWords;
};
var withoutMessageValues = function (args) {
    return args.filter(function (_, index) { var _a; return !MESSAGE_FLAG.test((_a = args[index - 1]) !== null && _a !== void 0 ? _a : ''); });
};
var finishesWithGit = function (rest) {
    var index = 0;
    while (rest[index] === '-C')
        index += 2;
    var subcommand = rest[index];
    var args = rest.slice(index + 1);
    if (subcommand === 'commit')
        return !withoutMessageValues(args).includes('--dry-run');
    if (subcommand === 'push')
        return !args.includes('--dry-run') && !args.some(function (arg) { return DRY_RUN_SHORT_FLAG.test(arg); });
    return false;
};
var finishesWithGh = function (rest) {
    return rest[0] === 'pr' && (rest[1] === 'create' || rest[1] === 'merge') && !rest.includes('--dry-run');
};
var finishesSegment = function (segment) {
    var segmentWords = shellWords(segment);
    var start = segmentWords.findIndex(function (word) { return !ASSIGNMENT.test(word); });
    if (start === -1)
        return false;
    var _a = segmentWords.slice(start), program = _a[0], rest = _a.slice(1);
    if (program === 'git')
        return finishesWithGit(rest);
    if (program === 'gh')
        return finishesWithGh(rest);
    return false;
};
// SAFETY: this is a lexer over the command text, not a shell parser, so it has known gaps. It misses a commit or push inside
// $(...), backticks, a subshell, or a then/do/{ block, behind sudo, env, or time, and with git -c, --git-dir, or gh -R. It
// reads $((1<<2)) as a heredoc opener, so it skips what follows, and counts `git push --help` as finishing a task. A miss
// only downgrades a strong signal to weak, and the one over-count needs a push that asks for help instead of pushing. Each
// gap needs a command shaped to hit it, which a person finishing a task rarely types, and the cost is one turn end judged
// as unfinished or finished, so no guard is worth the parser it would take.
var finishesTask = function (command) { return (0, exports.commandSegments)(command).some(finishesSegment); };
exports.finishesTask = finishesTask;
