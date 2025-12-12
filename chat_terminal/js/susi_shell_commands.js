function createShell(vfs, options = {}) {
    const hooks = options.hooks || {};
    const commandList = [];
    const commandMap = new Map();
    let currentPath = '/';
    const history = [];
    let sessionEnv = null;

    function resolvePath(inputPath) {
        if (!inputPath) return '';
        if (inputPath.startsWith('/')) return inputPath;
        return currentPath === '/' ? `/${inputPath}` : `${currentPath}${inputPath}`;
    }

    function ensureDirPath(path) {
        return path.endsWith('/') ? path : `${path}/`;
    }

    async function walkEntries(basePath, vfsRef = vfs) {
        const entries = await listEntries(basePath, vfsRef);
        return entries.map((entry) => {
            if (!entry) return null;
            let relative = String(entry);
            if (relative.startsWith('/')) relative = relative.slice(1);
            const isDir = relative.endsWith('/');
            const full = basePath === '/' ? `/${relative}` : `${basePath}${relative}`;
            return { relative, full, isDir };
        }).filter(Boolean);
    }

    async function listChildren(dirPath) {
        const entries = await walkEntries(dirPath);
        const children = new Set();
        for (let entry of entries) {
            const firstSegment = entry.relative.split('/')[0];
            if (firstSegment) children.add(firstSegment);
        }
        return Array.from(children);
    }

    async function listImmediateEntries(basePath, vfsRef = vfs) {
        const entries = await listEntries(basePath, vfsRef);
        const map = new Map();
        entries.forEach((entry) => {
            if (!entry) return;
            let relative = String(entry);
            if (relative.startsWith('/')) relative = relative.slice(1);
            const parts = relative.split('/').filter(Boolean);
            if (!parts.length) return;
            const name = parts[0];
            const isDir = parts.length > 1 || relative.endsWith('/');
            const prev = map.get(name);
            map.set(name, prev ? true : isDir);
        });
        return Array.from(map.entries()).map(([name, isDir]) => ({ name, isDir }));
    }

    async function dirExists(dirPath) {
        if (dirPath === '/') return true;
        try {
            await vfs.get(dirPath);
            return true;
        } catch (error) {
            const children = await listChildren(dirPath);
            return children.length > 0;
        }
    }

    function normalizeLsEntries(entries) {
        if (!Array.isArray(entries)) return [];
        return entries.map((entry) => String(entry)).filter(Boolean);
    }

    async function listEntries(path, vfsRef = vfs) {
        const entries = await vfsRef.ls(path);
        return normalizeLsEntries(entries);
    }

    function registerCommand(command) {
        if (!command || !command.name || !command.execute) return;
        const originalExecute = command.execute;
        const normalized = {
            summary: '',
            usage: command.name,
            details: '',
            category: 'shell',
            ...command,
            execute: async (args, ctx, input) => {
                let statusSet = false;
                const wrappedCtx = ctx ? {
                    ...ctx,
                    setExitStatus: (code) => {
                        statusSet = true;
                        if (typeof ctx.setExitStatus === 'function') ctx.setExitStatus(code);
                    }
                } : ctx;
                const result = await originalExecute(args, wrappedCtx, input);
                if (result && typeof result === 'object' && (Object.prototype.hasOwnProperty.call(result, 'output') || Object.prototype.hasOwnProperty.call(result, 'status'))) {
                    if (!statusSet && wrappedCtx && typeof wrappedCtx.setExitStatus === 'function' && Object.prototype.hasOwnProperty.call(result, 'status')) {
                        wrappedCtx.setExitStatus(result.status);
                        statusSet = true;
                    }
                    if (!statusSet && wrappedCtx && typeof wrappedCtx.setExitStatus === 'function') {
                        wrappedCtx.setExitStatus(0);
                    }
                    return typeof result.output === 'string' ? result.output : '';
                }
                if (!statusSet && wrappedCtx && typeof wrappedCtx.setExitStatus === 'function') {
                    wrappedCtx.setExitStatus(0);
                }
                return result;
            }
        };
        commandList.push(normalized);
        commandMap.set(normalized.name, normalized);
    }

    function parseCommandOptions(args, spec = {}) {
        const options = { ...(spec.defaults || {}) };
        const rest = [];
        const booleanFlags = spec.boolean || {};
        const valueFlags = spec.value || {};
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--') {
                rest.push(...args.slice(i + 1));
                break;
            }
            if (arg && arg.startsWith('-') && arg.length > 1) {
                if (Object.prototype.hasOwnProperty.call(valueFlags, arg) && args[i + 1] !== undefined) {
                    options[valueFlags[arg]] = args[i + 1];
                    i += 1;
                    continue;
                }
                const letters = arg.slice(1).split('');
                let matched = false;
                for (let c = 0; c < letters.length; c++) {
                    const flag = `-${letters[c]}`;
                    if (Object.prototype.hasOwnProperty.call(booleanFlags, flag)) {
                        options[booleanFlags[flag]] = true;
                        matched = true;
                    }
                }
                if (matched) continue;
            }
            rest.push(arg);
        }
        return { options, rest };
    }

    function tokenizeShell(command) {
        const tokens = [];
        let buffer = '';
        let inSingle = false;
        let inDouble = false;
        let inBacktick = false;
        let subshellDepth = 0;
        let arithDepth = 0;
        let hadQuote = false;
        const pushBuffer = () => {
            if (buffer) {
                if (!hadQuote) {
                    const keyword = buffer;
                    if (keyword === 'if') {
                        tokens.push({ type: 'IF', value: keyword });
                    } else if (keyword === 'elif') {
                        tokens.push({ type: 'ELIF', value: keyword });
                    } else if (keyword === 'then') {
                        tokens.push({ type: 'THEN', value: keyword });
                    } else if (keyword === 'else') {
                        tokens.push({ type: 'ELSE', value: keyword });
                    } else if (keyword === 'fi') {
                        tokens.push({ type: 'FI', value: keyword });
                    } else if (keyword === 'for') {
                        tokens.push({ type: 'FOR', value: keyword });
                    } else if (keyword === 'in') {
                        tokens.push({ type: 'IN', value: keyword });
                    } else if (keyword === 'while') {
                        tokens.push({ type: 'WHILE', value: keyword });
                    } else if (keyword === 'do') {
                        tokens.push({ type: 'DO', value: keyword });
                    } else if (keyword === 'done') {
                        tokens.push({ type: 'DONE', value: keyword });
                    } else {
                        tokens.push({ type: 'WORD', value: buffer });
                    }
                } else {
                    tokens.push({ type: 'WORD', value: buffer });
                }
                buffer = '';
                hadQuote = false;
            }
        };
        for (let i = 0; i < command.length; i++) {
            const char = command[i];
            const next = command[i + 1];
            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
                hadQuote = true;
                buffer += char;
                continue;
            }
            if (char === '"' && !inSingle) {
                inDouble = !inDouble;
                hadQuote = true;
                buffer += char;
                continue;
            }
            if (!inSingle && !inDouble) {
                if (char === '`') {
                    inBacktick = !inBacktick;
                    buffer += char;
                    continue;
                }
                if (!inBacktick && char === '$' && next === '(' && command[i + 2] === '(') {
                    arithDepth += 1;
                    buffer += '$((';
                    i += 2;
                    continue;
                }
                if (!inBacktick && arithDepth > 0 && char === ')' && next === ')') {
                    arithDepth = Math.max(0, arithDepth - 1);
                    buffer += '))';
                    i += 1;
                    continue;
                }
                if (!inBacktick && char === '$' && next === '(') {
                    subshellDepth += 1;
                    buffer += '$(';
                    i += 1;
                    continue;
                }
                if (!inBacktick && subshellDepth > 0 && arithDepth === 0 && char === ')') {
                    subshellDepth = Math.max(0, subshellDepth - 1);
                    buffer += char;
                    continue;
                }
            }
            if (!inSingle && !inDouble && !inBacktick && subshellDepth === 0 && arithDepth === 0) {
                if (char === '2' && next === '>' && buffer.length === 0) {
                    pushBuffer();
                    tokens.push({ type: 'REDIR_ERR' });
                    i += 1;
                    continue;
                }
                if (char === '>' && next === '>') {
                    pushBuffer();
                    tokens.push({ type: 'REDIR_APPEND' });
                    i += 1;
                    continue;
                }
                if (char === '&' && next === '&') {
                    pushBuffer();
                    tokens.push({ type: 'AND_IF' });
                    i += 1;
                    continue;
                }
                if (char === '&') {
                    // Treat "&" like ";" so background syntax is accepted but ignored.
                    pushBuffer();
                    tokens.push({ type: 'SEMI' });
                    continue;
                }
                if (char === '|' && next === '|') {
                    pushBuffer();
                    tokens.push({ type: 'OR_IF' });
                    i += 1;
                    continue;
                }
                if (char === '|') {
                    pushBuffer();
                    tokens.push({ type: 'PIPE' });
                    continue;
                }
                if (char === ';') {
                    pushBuffer();
                    tokens.push({ type: 'SEMI' });
                    continue;
                }
                if (char === '>') {
                    pushBuffer();
                    tokens.push({ type: 'REDIR_OUT' });
                    continue;
                }
                if (char === '<') {
                    pushBuffer();
                    tokens.push({ type: 'REDIR_IN' });
                    continue;
                }
                if (/\s/.test(char)) {
                    pushBuffer();
                    continue;
                }
            }
            buffer += char;
        }
        pushBuffer();
        tokens.push({ type: 'EOF' });
        return tokens;
    }

    function parseShellTokens(tokens) {
        const parser = {
            tokens,
            pos: 0,
            peek() { return this.tokens[this.pos]; },
            next() { return this.tokens[this.pos++]; },
            skip(type) {
                if (this.peek() && this.peek().type === type) { this.next(); return true; }
                return false;
            }
        };

        const stopTypes = new Set(['SEMI', 'AND_IF', 'OR_IF', 'PIPE', 'EOF']);

        const parseStatements = (endTypes) => {
            const statements = [];
            while (parser.peek() && !endTypes.has(parser.peek().type)) {
                if (parser.skip('SEMI')) continue;
                const stmt = parseStatement();
                if (stmt.error) return stmt;
                statements.push(stmt.node);
                parser.skip('SEMI');
            }
            return { node: statements, error: '' };
        };

        const parseStatement = () => {
            const token = parser.peek();
            if (!token) return { node: null, error: 'Error: Invalid command' };
            if (token.type === 'IF') return parseIf();
            if (token.type === 'FOR') return parseFor();
            if (token.type === 'WHILE') return parseWhile();
            return parseConditional();
        };

        const parseConditional = (endTypes) => {
            const chain = [];
            const first = parsePipeline(endTypes);
            if (first.error) return first;
            chain.push({ op: null, pipeline: first.node });
            while (parser.peek() && (parser.peek().type === 'AND_IF' || parser.peek().type === 'OR_IF')) {
                const opToken = parser.next();
                const next = parsePipeline(endTypes);
                if (next.error) return next;
                chain.push({ op: opToken.type === 'AND_IF' ? '&&' : '||', pipeline: next.node });
            }
            return { node: { type: 'cond', chain }, error: '' };
        };

        const parsePipeline = (endTypes) => {
            const commands = [];
            const cmd = parseCommand(endTypes);
            if (cmd.error) return cmd;
            commands.push(cmd.node);
            while (parser.peek() && parser.peek().type === 'PIPE') {
                parser.next();
                const next = parseCommand(endTypes);
                if (next.error) return next;
                commands.push(next.node);
            }
            return { node: { type: 'pipeline', commands }, error: '' };
        };

        const parseCommand = (endTypes) => {
            const args = [];
            const redir = { inputPath: null, outputPath: null, errPath: null, append: false };
            while (parser.peek() && !stopTypes.has(parser.peek().type) && !(endTypes && endTypes.has(parser.peek().type))) {
                const token = parser.peek();
                if (token.type === 'WORD') {
                    args.push(parser.next().value);
                    continue;
                }
                if (token.type === 'IF' || token.type === 'ELIF' || token.type === 'THEN' || token.type === 'ELSE' || token.type === 'FI' ||
                    token.type === 'FOR' || token.type === 'IN' || token.type === 'WHILE' || token.type === 'DO' || token.type === 'DONE') {
                    if (endTypes && endTypes.has(token.type)) break;
                    args.push(parser.next().value);
                    continue;
                }
                if (token.type === 'REDIR_IN' || token.type === 'REDIR_OUT' || token.type === 'REDIR_APPEND' || token.type === 'REDIR_ERR') {
                    const redirToken = parser.next();
                    const next = parser.peek();
                    if (!next || next.type !== 'WORD') {
                        return { node: null, error: 'Error: Missing redirection target' };
                    }
                    const target = stripQuotes(parser.next().value);
                    if (redirToken.type === 'REDIR_IN') {
                        redir.inputPath = target;
                    } else if (redirToken.type === 'REDIR_ERR') {
                        redir.errPath = target;
                    } else {
                        redir.outputPath = target;
                        redir.append = redirToken.type === 'REDIR_APPEND';
                    }
                    continue;
                }
                break;
            }
            if (!args.length) return { node: null, error: 'Error: Invalid command' };
            const hasRedir = Boolean(redir.inputPath || redir.outputPath || redir.errPath);
            if (!hasRedir && args.length === 1) {
                if (args[0] === 'break') return { node: { type: 'break' }, error: '' };
                if (args[0] === 'continue') return { node: { type: 'continue' }, error: '' };
                const assignMatch = args[0].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
                if (assignMatch) {
                    return { node: { type: 'assign', name: assignMatch[1], value: assignMatch[2] }, error: '' };
                }
            }
            if (args[0] === 'test' || args[0] === '[' || args[0] === '[[') {
                return { node: { type: 'builtin', name: args[0], args, redir }, error: '' };
            }
            return { node: { type: 'command', args, redir }, error: '' };
        };

        const parseIf = () => {
            parser.next();
            const cond = parseConditional(new Set(['THEN']));
            if (cond.error) return cond;
            while (parser.peek() && parser.peek().type === 'SEMI') parser.next();
            if (!parser.skip('THEN')) return { node: null, error: 'Error: Missing then' };
            const thenBody = parseStatements(new Set(['ELIF', 'ELSE', 'FI']));
            if (thenBody.error) return thenBody;
            const branches = [{ cond: cond.node, body: thenBody.node }];
            while (parser.peek() && parser.peek().type === 'ELIF') {
                parser.next();
                const elifCond = parseConditional(new Set(['THEN']));
                if (elifCond.error) return elifCond;
                while (parser.peek() && parser.peek().type === 'SEMI') parser.next();
                if (!parser.skip('THEN')) return { node: null, error: 'Error: Missing then' };
                const elifBody = parseStatements(new Set(['ELIF', 'ELSE', 'FI']));
                if (elifBody.error) return elifBody;
                branches.push({ cond: elifCond.node, body: elifBody.node });
            }
            let elseBody = null;
            if (parser.peek() && parser.peek().type === 'ELSE') {
                parser.next();
                const elseParsed = parseStatements(new Set(['FI']));
                if (elseParsed.error) return elseParsed;
                elseBody = elseParsed.node;
            }
            if (!parser.skip('FI')) return { node: null, error: 'Error: Missing fi' };
            return { node: { type: 'if', branches, elseBody }, error: '' };
        };

        const parseFor = () => {
            parser.next();
            const varToken = parser.next();
            if (!varToken || varToken.type !== 'WORD') return { node: null, error: 'Error: Invalid for' };
            if (!parser.skip('IN')) return { node: null, error: 'Error: Invalid for' };
            const items = [];
            while (parser.peek() && parser.peek().type !== 'DO') {
                if (parser.peek().type === 'SEMI') { parser.next(); continue; }
                if (parser.peek().type !== 'WORD') return { node: null, error: 'Error: Invalid for' };
                items.push(parser.next().value);
            }
            if (!parser.skip('DO')) return { node: null, error: 'Error: Missing do' };
            const body = parseStatements(new Set(['DONE']));
            if (body.error) return body;
            if (!parser.skip('DONE')) return { node: null, error: 'Error: Missing done' };
            return { node: { type: 'for', varName: varToken.value, items, body: body.node }, error: '' };
        };

        const parseWhile = () => {
            parser.next();
            const cond = parseConditional(new Set(['DO']));
            if (cond.error) return cond;
            while (parser.peek() && parser.peek().type === 'SEMI') parser.next();
            if (!parser.skip('DO')) return { node: null, error: 'Error: Missing do' };
            const body = parseStatements(new Set(['DONE']));
            if (body.error) return body;
            if (!parser.skip('DONE')) return { node: null, error: 'Error: Missing done' };
            return { node: { type: 'while', cond: cond.node, body: body.node }, error: '' };
        };

        const parsed = parseStatements(new Set(['EOF']));
        if (parsed.error) return parsed;
        if (!parser.skip('EOF')) return { node: null, error: 'Error: Invalid command' };
        return { node: parsed.node, error: '' };
    }


    function prepareShellInput(input) {
        if (!input) return '';
        const command = String(input);
        if (!command.includes('\n')) return command;
        const lines = command.split(/\r?\n/);
        const merged = [];
        let buffer = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            if (!buffer && trimmedLine.startsWith('#')) continue;
            const trimmed = line.replace(/\s+$/, '');
            if (trimmed.endsWith('/')) {
                buffer += trimmed.slice(0, -1) + ' ';
                continue;
            }
            buffer += line;
            if (buffer.trim()) merged.push(buffer.trim());
            buffer = '';
        }
        if (buffer.trim()) merged.push(buffer.trim());
        return merged.length <= 1 ? (merged[0] || '') : merged.join('; ');
    }

    function recordHistory(command) {
        if (!command) return;
        history.push(command);
    }

    function resolveHistory(command) {
        const match = command.match(/^!(\d+)$/);
        if (!match) return null;
        const index = Number(match[1]);
        if (!Number.isFinite(index) || index < 1 || index > history.length) return '';
        return history[index - 1];
    }


    function getContext() {
        return {
            vfs,
            hooks,
            resolvePath,
            ensureDirPath,
            listChildren,
            dirExists,
            getCurrentPath: () => currentPath,
            setCurrentPath: (path) => { currentPath = path; }
        };
    }

    function stripQuotes(value) {
        if (!value || value.length < 2) return value;
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
        return value;
    }

    async function readFileContent(path, ctx) {
        if (path.endsWith('/')) throw new Error('Path is a directory');
        const content = await ctx.vfs.get(path);
        if (typeof content === 'string') return content;
        if (content instanceof ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(content));
        }
        if (content instanceof Uint8Array) {
            return new TextDecoder().decode(content);
        }
        if (ArrayBuffer.isView(content)) {
            return new TextDecoder().decode(new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)));
        }
        return String(content);
    }

    function splitLines(content) {
        if (content === '') return [];
        const parts = content.split(/\r?\n/);
        if (parts.length > 1 && parts[parts.length - 1] === '') {
            parts.pop();
        }
        return parts;
    }

    function formatOutput(value, ctx) {
        if (Array.isArray(value)) {
            return ctx && ctx.outputMode === 'text' ? value.join('\n') : value.join('<br>');
        }
        if (!value) return '';
        const text = String(value);
        if (ctx && ctx.outputMode === 'text') return text;
        return splitLines(text).join('<br>');
    }

    async function handleCommandOutput(command, outputText, isError, input, envMap, finalStatus) {
        if (command.redir.errPath && isError) {
            const errPath = resolvePath(command.redir.errPath);
            if (command.redir.append) {
                let existing = '';
                try {
                    existing = await vfs.get(errPath);
                } catch (error) {
                    existing = '';
                }
                await vfs.put(errPath, existing + outputText);
            } else {
                await vfs.put(errPath, outputText);
            }
            envMap['?'] = finalStatus;
            return '';
        }
        if (command.redir.outputPath && !isError) {
            const outPath = resolvePath(command.redir.outputPath);
            if (command.redir.append) {
                let existing = '';
                try {
                    existing = await vfs.get(outPath);
                } catch (error) {
                    existing = '';
                }
                await vfs.put(outPath, existing + outputText);
            } else {
                await vfs.put(outPath, outputText);
            }
            envMap['?'] = finalStatus;
            return '';
        }
        envMap['?'] = finalStatus;
        return outputText;
    }

    function decodeEscapes(value) {
        if (!value) return '';
        return value
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r');
    }

    function errorResult(ctx, message, code = 1) {
        const text = message.startsWith('Error:') ? message : `Error: ${message}`;
        return { output: text, status: code };
    }

    function expandCharSet(value) {
        if (!value) return '';
        let result = '';
        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            const next = value[i + 1];
            const nextNext = value[i + 2];
            if (next === '-' && nextNext) {
                const start = char.charCodeAt(0);
                const end = nextNext.charCodeAt(0);
                if (start <= end) {
                    for (let code = start; code <= end; code++) {
                        result += String.fromCharCode(code);
                    }
                    i += 2;
                    continue;
                }
            }
            result += char;
        }
        return result;
    }

    async function readConfig() {
        const path = '/config.json';
        try {
            const raw = await vfs.get(path);
            const config = JSON.parse(raw);
            if (!Object.prototype.hasOwnProperty.call(config, 'PATH')) {
                config.PATH = '/bin:/usr/bin';
                await writeConfig(config);
            }
            return config;
        } catch (error) {
            if (typeof defaultConfig !== 'undefined') {
                const config = JSON.parse(JSON.stringify(defaultConfig));
                if (!Object.prototype.hasOwnProperty.call(config, 'PATH')) {
                    config.PATH = '/bin:/usr/bin';
                    await writeConfig(config);
                }
                return config;
            }
            return {};
        }
    }

    async function getSessionEnv() {
        if (sessionEnv) return sessionEnv;
        const config = await readConfig();
        sessionEnv = {};
        Object.keys(config || {}).forEach((key) => {
            const value = config[key];
            sessionEnv[key] = typeof value === 'string' ? value : JSON.stringify(value);
        });
        return sessionEnv;
    }

    function cloneEnv(envMap) {
        const clone = {};
        Object.keys(envMap || {}).forEach((key) => {
            clone[key] = String(envMap[key]);
        });
        return clone;
    }

    async function writeConfig(config) {
        const path = '/config.json';
        await vfs.put(path, JSON.stringify(config, null, 2));
    }

    function expandArg(token, envMap) {
        if (token === null || token === undefined) return '';
        if (!envMap) envMap = {};
        const raw = String(token);
        if (raw === '') return '';
        const isSingleQuoted = raw.startsWith("'") && raw.endsWith("'");
        const isDoubleQuoted = raw.startsWith('"') && raw.endsWith('"');
        let value = raw;
        if (isSingleQuoted) {
            value = stripQuotes(value);
        } else if (isDoubleQuoted) {
            value = stripQuotes(value);
        }
        value = value.replace(/\$\?/g, () => {
            if (!Object.prototype.hasOwnProperty.call(envMap, '?')) return '';
            return String(envMap['?']);
        });
        value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(envMap, name)) return '';
            return envMap[name];
        });
        return value;
    }

    function normalizeSubstitutionOutput(output) {
        if (!output) return '';
        const normalized = output.replace(/<br>/g, '\n').replace(/\r?\n/g, ' ').trim();
        return normalized;
    }

    async function expandCommandSubstitutions(command, envMap) {
        let result = '';
        let i = 0;
        let inSingle = false;
        let inDouble = false;
        while (i < command.length) {
            const char = command[i];
            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
                result += char;
                i += 1;
                continue;
            }
            if (char === '"' && !inSingle) {
                inDouble = !inDouble;
                result += char;
                i += 1;
                continue;
            }
            if (char === '$' && command[i + 1] === '(' && command[i + 2] === '(' && !inSingle) {
                result += char;
                i += 1;
                continue;
            }
            if (char === '$' && command[i + 1] === '(' && !inSingle) {
                let depth = 1;
                let j = i + 2;
                let inner = '';
                let innerSingle = false;
                let innerDouble = false;
                let arithDepth = 0;
                while (j < command.length) {
                    const innerChar = command[j];
                    if (innerChar === "'" && !innerDouble) {
                        innerSingle = !innerSingle;
                    } else if (innerChar === '"' && !innerSingle) {
                        innerDouble = !innerDouble;
                    }
                    if (!innerSingle && !innerDouble && innerChar === '$' && command[j + 1] === '(' && command[j + 2] === '(') {
                        arithDepth += 1;
                        inner += '$((';
                        j += 3;
                        continue;
                    }
                    if (!innerSingle && !innerDouble && innerChar === '$' && command[j + 1] === '(') {
                        depth += 1;
                        inner += '$(';
                        j += 2;
                        continue;
                    }
                    if (!innerSingle && !innerDouble && arithDepth > 0 && innerChar === ')' && command[j + 1] === ')') {
                        arithDepth -= 1;
                        inner += '))';
                        j += 2;
                        continue;
                    }
                    if (!innerSingle && !innerDouble && arithDepth > 0) {
                        inner += innerChar;
                        j += 1;
                        continue;
                    }
                    if (innerChar === ')' && !innerSingle && !innerDouble) {
                        depth -= 1;
                        if (depth === 0) break;
                    }
                    inner += innerChar;
                    j += 1;
                }
                if (depth !== 0) {
                    result += char;
                    i += 1;
                    continue;
                }
                const substitution = inner.trim();
                const subResult = await executeCommand(substitution, { env: envMap, recordHistory: false });
                if (!subResult.handled) {
                    return { command, error: 'Error: Invalid command' };
                }
                result += normalizeSubstitutionOutput(subResult.output || '');
                i = j + 1;
                continue;
            }
            if (char === '`' && !inSingle) {
                let j = i + 1;
                let inner = '';
                let innerSingle = false;
                let innerDouble = false;
                while (j < command.length) {
                    const innerChar = command[j];
                    if (innerChar === '\\') {
                        const nextChar = command[j + 1];
                        if (nextChar === '\n' || nextChar === '\r') {
                            j += 2;
                            continue;
                        }
                        if (nextChar === '`' || nextChar === '\\' || nextChar === '$') {
                            inner += nextChar;
                            j += 2;
                            continue;
                        }
                        inner += nextChar || '';
                        j += nextChar ? 2 : 1;
                        continue;
                    }
                    if (innerChar === "'" && !innerDouble) {
                        innerSingle = !innerSingle;
                    } else if (innerChar === '"' && !innerSingle) {
                        innerDouble = !innerDouble;
                    } else if (innerChar === '`' && !innerSingle) {
                        break;
                    }
                    inner += innerChar;
                    j += 1;
                }
                if (j >= command.length || command[j] !== '`') {
                    result += char;
                    i += 1;
                    continue;
                }
                const substitution = inner.trim();
                const subResult = await executeCommand(substitution, { env: envMap, recordHistory: false });
                if (!subResult.handled) {
                    return { command, error: 'Error: Invalid command' };
                }
                result += normalizeSubstitutionOutput(subResult.output || '');
                i = j + 1;
                continue;
            }
            result += char;
            i += 1;
        }
        return { command: result, error: '' };
    }

    function evalArithmeticExpression(expression, envMap) {
        if (!expression) return { value: '', error: 'Error: Invalid arithmetic' };
        let expr = expression.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(envMap, name)) return '0';
            const num = Number(envMap[name]);
            return Number.isFinite(num) ? String(num) : '0';
        });
        expr = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(envMap, name)) return '0';
            const num = Number(envMap[name]);
            return Number.isFinite(num) ? String(num) : '0';
        });
        const tokens = [];
        let i = 0;
        while (i < expr.length) {
            const char = expr[i];
            if (/\s/.test(char)) {
                i += 1;
                continue;
            }
            if (/[0-9.]/.test(char)) {
                let num = char;
                i += 1;
                while (i < expr.length && /[0-9.]/.test(expr[i])) {
                    num += expr[i++];
                }
                tokens.push({ type: 'num', value: num });
                continue;
            }
            if ('+-*/%()'.includes(char)) {
                tokens.push({ type: 'op', value: char });
                i += 1;
                continue;
            }
            return { value: '', error: 'Error: Invalid arithmetic' };
        }
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];

        const parseExpression = () => {
            let node = parseTerm();
            while (peek() && (peek().value === '+' || peek().value === '-')) {
                const op = next().value;
                const right = parseTerm();
                node = { type: 'bin', op, left: node, right };
            }
            return node;
        };

        const parseTerm = () => {
            let node = parseFactor();
            while (peek() && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
                const op = next().value;
                const right = parseFactor();
                node = { type: 'bin', op, left: node, right };
            }
            return node;
        };

        const parseFactor = () => {
            const token = peek();
            if (!token) throw new Error('eof');
            if (token.type === 'op' && (token.value === '+' || token.value === '-')) {
                const op = next().value;
                const right = parseFactor();
                return { type: 'unary', op, right };
            }
            if (token.type === 'num') {
                next();
                return { type: 'num', value: Number(token.value) };
            }
            if (token.type === 'op' && token.value === '(') {
                next();
                const node = parseExpression();
                if (!peek() || peek().value !== ')') throw new Error('paren');
                next();
                return node;
            }
            throw new Error('token');
        };

        const evalNode = (node) => {
            if (node.type === 'num') return node.value;
            if (node.type === 'unary') {
                const v = evalNode(node.right);
                return node.op === '-' ? -v : v;
            }
            if (node.type === 'bin') {
                const left = evalNode(node.left);
                const right = evalNode(node.right);
                if (node.op === '+') return left + right;
                if (node.op === '-') return left - right;
                if (node.op === '*') return left * right;
                if (node.op === '/') return right === 0 ? 0 : left / right;
                if (node.op === '%') return right === 0 ? 0 : left % right;
            }
            return 0;
        };

        try {
            const ast = parseExpression();
            if (pos < tokens.length) return { value: '', error: 'Error: Invalid arithmetic' };
            const result = evalNode(ast);
            if (!Number.isFinite(result)) return { value: '0', error: '' };
            return { value: String(Math.trunc(result)), error: '' };
        } catch (error) {
            return { value: '', error: 'Error: Invalid arithmetic' };
        }
    }

    async function expandArithmetic(value, envMap) {
        let output = '';
        let i = 0;
        while (i < value.length) {
            if (value[i] === '$' && value[i + 1] === '(' && value[i + 2] === '(') {
                let j = i + 3;
                let depth = 1;
                let inner = '';
                while (j < value.length) {
                    if (value[j] === '(' && value[j - 1] !== '$') {
                        depth += 1;
                    } else if (value[j] === ')' && value[j + 1] === ')') {
                        depth -= 1;
                        if (depth === 0) break;
                    }
                    inner += value[j];
                    j += 1;
                }
                if (depth !== 0) {
                    output += value[i];
                    i += 1;
                    continue;
                }
                const evaluated = evalArithmeticExpression(inner.trim(), envMap);
                if (evaluated.error) return { value: '', error: evaluated.error };
                output += evaluated.value;
                i = j + 2;
                continue;
            }
            output += value[i];
            i += 1;
        }
        return { value: output, error: '' };
    }

    async function expandWord(value, envMap) {
        let expanded = value;
        if (expanded.includes('$(') || expanded.includes('`')) {
            const sub = await expandCommandSubstitutions(expanded, envMap);
            if (sub.error) return { value: '', error: sub.error };
            expanded = sub.command;
        }
        if (expanded.includes('$((')) {
            const arith = await expandArithmetic(expanded, envMap);
            if (arith.error) return { value: '', error: arith.error };
            expanded = arith.value;
        }
        expanded = expandArg(expanded, envMap);
        return { value: expanded, error: '' };
    }

    function hasGlobChars(value) {
        return /[*?\[]/.test(value || '');
    }

    function globToRegex(pattern) {
        let regex = '';
        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];
            if (char === '*') {
                regex += '.*';
                continue;
            }
            if (char === '?') {
                regex += '.';
                continue;
            }
            if (char === '[') {
                const close = pattern.indexOf(']', i + 1);
                if (close !== -1) {
                    regex += pattern.slice(i, close + 1);
                    i = close;
                    continue;
                }
            }
            if (/[-/\\^$+?.()|{}]/.test(char)) {
                regex += '\\' + char;
            } else {
                regex += char;
            }
        }
        return regex;
    }

    function matchGlob(value, pattern) {
        try {
            const regex = new RegExp(`^${globToRegex(pattern)}$`);
            return regex.test(value);
        } catch (error) {
            return false;
        }
    }

    async function resolveScriptPath(target, ctx, envMap) {
        if (!target) return null;
        const hasSlash = target.includes('/');
        if (hasSlash || target.startsWith('.')) {
            return ctx.resolvePath(target);
        }
        const pathValue = envMap && envMap.PATH ? String(envMap.PATH) : '';
        const searchDirs = pathValue ? pathValue.split(':') : [];
        for (let i = 0; i < searchDirs.length; i++) {
            const base = searchDirs[i];
            if (!base) continue;
            const dir = base.endsWith('/') ? base : base + '/';
            const candidate = dir + target;
            try {
                const content = await ctx.vfs.get(candidate);
                if (content !== undefined) return candidate;
            } catch (error) {
                // keep searching
            }
        }
        return null;
    }

    function splitWords(value) {
        if (!value) return [];
        return value.split(/\s+/).filter(Boolean);
    }

    async function expandLoopItems(items, ctx, envMap) {
        const expanded = [];
        for (let i = 0; i < items.length; i++) {
            let value = expandArg(items[i], envMap);
            if (value.includes('$(') || value.includes('`')) {
                const sub = await expandCommandSubstitutions(value, envMap);
                if (sub.error) return { error: sub.error, items: [] };
                value = sub.command;
            }
            const words = splitWords(value);
            if (!words.length) continue;
            for (let w = 0; w < words.length; w++) {
                const word = words[w];
                if (hasGlobChars(word)) {
                    const base = ctx.getCurrentPath();
                    try {
                        const entries = await ctx.vfs.ls(base);
                        const matches = entries
                            .map((entry) => entry.endsWith('/') ? entry.slice(0, -1) : entry)
                            .filter((entry) => matchGlob(entry, word));
                        if (matches.length) {
                            expanded.push(...matches);
                            continue;
                        }
                    } catch (error) {
                        // fall through
                    }
                }
                expanded.push(word);
            }
        }
        return { error: '', items: expanded };
    }

    async function executeStatements(statements, ctx, envMap) {
        let combinedOutput = '';
        for (let i = 0; i < statements.length; i++) {
            const result = await executeStatement(statements[i], ctx, envMap);
            if (result && result.output) {
                combinedOutput = combinedOutput ? combinedOutput + '<br>' + result.output : result.output;
            }
            if (result && result.signal) {
                return { output: combinedOutput, signal: result.signal };
            }
        }
        return { output: combinedOutput, signal: null };
    }

    async function executeStatement(statement, ctx, envMap) {
        if (!statement) return { output: '', signal: null };
        if (statement.type === 'if') {
            let executed = false;
            for (let i = 0; i < statement.branches.length; i++) {
                const condResult = await executeCondition(statement.branches[i].cond, ctx, envMap);
                if (condResult.error) return { output: condResult.error, signal: null };
                if (condResult.signal) return condResult;
                if (envMap['?'] === '0') {
                    const bodyResult = await executeStatements(statement.branches[i].body, ctx, envMap);
                    if (bodyResult.signal) return bodyResult;
                    if (bodyResult.output) return bodyResult;
                    executed = true;
                    break;
                }
            }
            if (!executed && statement.elseBody) {
                const elseResult = await executeStatements(statement.elseBody, ctx, envMap);
                if (elseResult.signal) return elseResult;
                if (elseResult.output) return elseResult;
            }
            return { output: '', signal: null };
        }
        if (statement.type === 'for') {
            const expandedItems = await expandLoopItems(statement.items, ctx, envMap);
            if (expandedItems.error) return { output: expandedItems.error, signal: null };
            let output = '';
            for (let i = 0; i < expandedItems.items.length; i++) {
                envMap[statement.varName] = expandedItems.items[i];
                const bodyResult = await executeStatements(statement.body, ctx, envMap);
                if (bodyResult.signal === '__BREAK__') break;
                if (bodyResult.signal === '__CONTINUE__') continue;
                if (bodyResult.output) {
                    output = output ? output + '<br>' + bodyResult.output : bodyResult.output;
                }
            }
            return { output, signal: null };
        }
        if (statement.type === 'while') {
            let output = '';
            while (true) {
                const condResult = await executeCondition(statement.cond, ctx, envMap);
                if (condResult.error) return { output: condResult.error, signal: null };
                if (condResult.signal) return condResult;
                if (envMap['?'] !== '0') break;
                const bodyResult = await executeStatements(statement.body, ctx, envMap);
                if (bodyResult.signal === '__BREAK__') break;
                if (bodyResult.signal === '__CONTINUE__') continue;
                if (bodyResult.output) {
                    output = output ? output + '<br>' + bodyResult.output : bodyResult.output;
                }
            }
            return { output, signal: null };
        }
        if (statement.type === 'cond') {
            const condResult = await executeCondition(statement, ctx, envMap);
            if (condResult.error) return { output: condResult.error, signal: null };
            if (condResult.signal) return condResult;
            return { output: condResult.output || '', signal: null };
        }
        return { output: 'Error: Invalid command', signal: null };
    }

    async function executeCondition(condition, ctx, envMap) {
        let output = '';
        let lastStatus = envMap['?'] || '0';
        for (let i = 0; i < condition.chain.length; i++) {
            const entry = condition.chain[i];
            if (entry.op === '&&' && lastStatus !== '0') continue;
            if (entry.op === '||' && lastStatus === '0') continue;
            const result = await executePipeline(entry.pipeline, ctx, envMap);
            if (result.error) return result;
            if (result.signal) return result;
            if (result.output) {
                output = output ? output + '<br>' + result.output : result.output;
            }
            lastStatus = envMap['?'] || '0';
        }
        return { output, error: '', signal: null };
    }

    async function executePipeline(pipeline, ctx, envMap) {
        let input = '';
        for (let i = 0; i < pipeline.commands.length; i++) {
            const command = pipeline.commands[i];
            if (command.type === 'assign') {
                if (pipeline.commands.length > 1) {
                    envMap['?'] = '1';
                    return { output: '', error: 'Error: Invalid pipeline', signal: null };
                }
                const expandedValue = await expandWord(command.value, envMap);
                if (expandedValue.error) return { output: '', error: expandedValue.error, signal: null };
                envMap[command.name] = expandedValue.value;
                envMap['?'] = '0';
                return { output: '', error: '', signal: null };
            }
            if (command.type === 'break' || command.type === 'continue') {
                if (pipeline.commands.length > 1) {
                    envMap['?'] = '1';
                    return { output: '', error: 'Error: Invalid pipeline', signal: null };
                }
                return { output: '', error: '', signal: command.type === 'break' ? '__BREAK__' : '__CONTINUE__' };
            }
            const isBuiltin = command.type === 'builtin';
            let args = [];
            if (isBuiltin) {
                for (let a = 0; a < command.args.length; a++) {
                    const expanded = await expandWord(command.args[a], envMap);
                    if (expanded.error) return { output: '', error: expanded.error, signal: null };
                    args.push(expanded.value);
                }
            } else {
                if (!command || !command.args || !command.args.length) {
                    envMap['?'] = '1';
                    return { output: '', error: 'Error: Invalid command', signal: null };
                }
                for (let a = 0; a < command.args.length; a++) {
                    const expanded = await expandWord(command.args[a], envMap);
                    if (expanded.error) return { output: '', error: expanded.error, signal: null };
                    args.push(expanded.value);
                }
                const assignMatch = args[0] ? args[0].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) : null;
                if (assignMatch && !commandMap.has(args[0])) {
                    const rest = args.length > 1 ? ' ' + args.slice(1).join(' ') : '';
                    envMap[assignMatch[1]] = assignMatch[2] + rest;
                    envMap['?'] = '0';
                    return { output: '', error: '', signal: null };
                }
            }
            const commandName = isBuiltin ? command.name : args[0];
            if (!isBuiltin && commandName === 'exit') {
                const code = args[1] && !Number.isNaN(Number(args[1])) ? Number(args[1]) : 0;
                envMap['?'] = String(code);
                return { output: '', error: '', signal: '__EXIT__' };
            }
            if (!commandMap.has(commandName)) {
                envMap['?'] = '127';
                return { output: '', error: 'Error: Invalid command', signal: null };
            }
            if (command.redir.inputPath && i > 0) {
                envMap['?'] = '1';
                return { output: '', error: 'Error: Input redirection must be on the first command', signal: null };
            }
            if ((command.redir.outputPath || command.redir.errPath) && i < pipeline.commands.length - 1) {
                envMap['?'] = '1';
                return { output: '', error: 'Error: Output redirection must be on the last command', signal: null };
            }
            if (command.redir.inputPath && input) {
                envMap['?'] = '1';
                return { output: '', error: 'Error: Input already provided', signal: null };
            }
            if (command.redir.inputPath) {
                try {
                    const content = await vfs.get(resolvePath(command.redir.inputPath));
                    input = typeof content === 'string' ? content : new TextDecoder().decode(content);
                } catch (error) {
                    envMap['?'] = '1';
                    return { output: '', error: 'Error: Unable to read input file', signal: null };
                }
            }
            const handler = commandMap.get(commandName);
            const outputMode = command.redir.outputPath || command.redir.errPath || i < pipeline.commands.length - 1 ? 'text' : 'html';
            let exitStatusOverride = null;
            const cmdCtx = {
                ...ctx,
                env: envMap,
                outputMode,
                hasInput: i > 0 || Boolean(input) || Boolean(command.redir.inputPath),
                setExitStatus: (code) => { exitStatusOverride = String(code); }
            };
            const output = await handler.execute(args, cmdCtx, input);
            const outputText = typeof output === 'string' ? output : '';
            const isError = outputText.startsWith('Error:');
            const finalStatus = exitStatusOverride !== null ? exitStatusOverride : '0';
            input = await handleCommandOutput(command, outputText, isError, input, envMap, finalStatus);
            if (typeof input !== 'string') input = '';
        }
        return { output: input || '', error: '', signal: null };
    }


    async function evaluateTestExpression(tokens, ctx, allowRegex) {
        if (!tokens.length) return { ok: false, error: 'Error: Missing operand' };
        if (tokens.length === 2) {
            const op = tokens[0];
            const value = tokens[1];
            if (op === '-z') return { ok: value.length === 0, error: '' };
            if (op === '-n') return { ok: value.length !== 0, error: '' };
            if (op === '-e' || op === '-f' || op === '-d') {
                const target = ctx.resolvePath(value);
                try {
                    if (op === '-e') {
                        await ctx.vfs.get(target);
                        return { ok: true, error: '' };
                    }
                    if (op === '-f') {
                        if (target.endsWith('/')) return { ok: false, error: 'Error: Not a file' };
                        await ctx.vfs.get(target);
                        return { ok: true, error: '' };
                    }
                    const dirPath = ctx.ensureDirPath(target);
                    if (await ctx.dirExists(dirPath)) return { ok: true, error: '' };
                    return { ok: false, error: 'Error: Not a directory' };
                } catch (error) {
                    return { ok: false, error: 'Error: Not found' };
                }
            }
        }
        if (tokens.length === 3) {
            const left = tokens[0];
            const op = tokens[1];
            const right = tokens[2];
            if (op === '=' || op === '!=') {
                const matches = hasGlobChars(right) ? matchGlob(left, right) : left === right;
                const ok = op === '=' ? matches : !matches;
                return { ok, error: '' };
            }
            if (op === '=~' && allowRegex) {
                let pattern = right;
                let flags = '';
                if (right.startsWith('/') && right.lastIndexOf('/') > 0) {
                    const lastSlash = right.lastIndexOf('/');
                    pattern = right.slice(1, lastSlash);
                    flags = right.slice(lastSlash + 1);
                }
                try {
                    const regex = new RegExp(pattern, flags);
                    return { ok: regex.test(left), error: '' };
                } catch (error) {
                    return { ok: false, error: 'Error: Invalid regex' };
                }
            }
            if (['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op)) {
                const lnum = Number(left);
                const rnum = Number(right);
                if (Number.isNaN(lnum) || Number.isNaN(rnum)) return { ok: false, error: 'Error: Invalid number' };
                let ok = false;
                if (op === '-eq') ok = lnum === rnum;
                if (op === '-ne') ok = lnum !== rnum;
                if (op === '-lt') ok = lnum < rnum;
                if (op === '-le') ok = lnum <= rnum;
                if (op === '-gt') ok = lnum > rnum;
                if (op === '-ge') ok = lnum >= rnum;
                return { ok, error: '' };
            }
        }
        return { ok: false, error: 'Error: Invalid flag' };
    }

    async function runShellScript(script, ctx, envMap) {
        const tokens = tokenizeShell(prepareShellInput(script));
        const parsed = parseShellTokens(tokens);
        if (parsed.error) return parsed.error;
        const result = await executeStatements(parsed.node, ctx, envMap);
        if (result && result.output) return result.output;
        return '';
    }

    function toUint8Array(content) {
        if (content instanceof Uint8Array) return content;
        if (content instanceof ArrayBuffer) return new Uint8Array(content);
        if (ArrayBuffer.isView(content)) {
            return new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
        }
        const encoder = new TextEncoder();
        return encoder.encode(typeof content === 'string' ? content : String(content));
    }

    function writeOctal(value, length) {
        const octal = value.toString(8);
        return octal.padStart(length - 1, '0') + '\0';
    }

    function buildTar(files) {
        const blocks = [];
        files.forEach((file) => {
            const name = file.name.length > 100 ? file.name.slice(0, 100) : file.name;
            const data = toUint8Array(file.data);
            const header = new Uint8Array(512);
            const encoder = new TextEncoder();
            header.set(encoder.encode(name), 0);
            header.set(encoder.encode(writeOctal(0o644, 8)), 100);
            header.set(encoder.encode(writeOctal(0, 8)), 108);
            header.set(encoder.encode(writeOctal(0, 8)), 116);
            header.set(encoder.encode(writeOctal(data.length, 12)), 124);
            header.set(encoder.encode(writeOctal(Math.floor(Date.now() / 1000), 12)), 136);
            header.set(encoder.encode('        '), 148);
            header.set(encoder.encode('0'), 156);
            header.set(encoder.encode('ustar\0'), 257);
            header.set(encoder.encode('00'), 263);
            let checksum = 0;
            for (let i = 0; i < header.length; i++) checksum += header[i];
            const checksumText = writeOctal(checksum, 8);
            header.set(encoder.encode(checksumText), 148);
            blocks.push(header);
            blocks.push(data);
            const padding = (512 - (data.length % 512)) % 512;
            if (padding) blocks.push(new Uint8Array(padding));
        });
        blocks.push(new Uint8Array(1024));
        const totalLength = blocks.reduce((sum, block) => sum + block.length, 0);
        const tar = new Uint8Array(totalLength);
        let offset = 0;
        blocks.forEach((block) => {
            tar.set(block, offset);
            offset += block.length;
        });
        return tar;
    }

    function parseTar(buffer) {
        const data = toUint8Array(buffer);
        const decoder = new TextDecoder();
        const entries = [];
        let offset = 0;
        while (offset + 512 <= data.length) {
            const header = data.slice(offset, offset + 512);
            offset += 512;
            const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/, '');
            if (!name) break;
            const sizeText = decoder.decode(header.slice(124, 136)).replace(/\0.*$/, '').trim();
            const size = parseInt(sizeText || '0', 8) || 0;
            const fileData = data.slice(offset, offset + size);
            entries.push({ name, data: fileData });
            offset += size;
            const padding = (512 - (size % 512)) % 512;
            offset += padding;
        }
        return entries;
    }

    async function executeCommand(command, options = {}) {
        if (!command) return { handled: false, output: '' };
        const { env, recordHistory: record = true } = options;
        const envMap = env || {};
        command = prepareShellInput(command);
        const historyExpansion = resolveHistory(command.trim());
        if (historyExpansion === '') {
            envMap['?'] = '1';
            return { handled: true, output: 'Error: History entry not found' };
        }
        if (historyExpansion) command = historyExpansion;
        if (!Object.prototype.hasOwnProperty.call(envMap, '?')) envMap['?'] = '0';
        const expanded = await expandCommandSubstitutions(command, envMap);
        if (expanded.error) {
            envMap['?'] = '1';
            return { handled: true, output: expanded.error };
        }
        command = expanded.command;
        if (record) recordHistory(command.trim());
        const tokens = tokenizeShell(command);
        const hasOperators = tokens.some((token) => token.type !== 'WORD' && token.type !== 'EOF');
        if (!hasOperators) {
            const firstWord = tokens.find((token) => token.type === 'WORD');
            if (firstWord) {
                const assignMatch = firstWord.value.match(/^[A-Za-z_][A-Za-z0-9_]*=/);
                if (!assignMatch && !commandMap.has(firstWord.value)) {
                    return { handled: false, output: '' };
                }
            }
        }
        const parsed = parseShellTokens(tokens);
        if (parsed.error) {
            envMap['?'] = '1';
            return { handled: true, output: parsed.error };
        }
        const result = await executeStatements(parsed.node, getContext(), envMap);
        return { handled: true, output: result && result.output ? result.output : '' };
    }

    async function execute(command) {
        const envMap = await getSessionEnv();
        return await executeCommand(command, { env: envMap, recordHistory: true });
    }

    function listCommands() {
        return commandList.slice();
    }

    async function collectTreePaths(basePath) {
        const entries = await walkEntries(basePath);
        const files = [];
        const dirs = new Set();
        entries.forEach((entry) => {
            if (entry.isDir) {
                dirs.add(entry.full);
                return;
            }
            files.push(entry.full);
            const parts = entry.full.split('/').filter(Boolean);
            let current = '/';
            for (let i = 0; i < parts.length - 1; i++) {
                current += parts[i] + '/';
                dirs.add(current);
            }
        });
        return { files, dirs: Array.from(dirs) };
    }

    registerCommand({
        name: 'touch',
        summary: 'Create a file.',
        usage: 'touch <file>',
        execute: (args, ctx) => {
            if (!args[1]) {
                return { output: '', status: 1 };
            }
            const path = ctx.resolvePath(args[1]);
            ctx.vfs.touch(path);
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'env',
        summary: 'Display environment variables.',
        usage: 'env',
        execute: async (args, ctx) => {
            const envMap = ctx.env || {};
            const lines = Object.keys(envMap).map((key) => `${key}=${envMap[key]}`);
            return { output: formatOutput(lines, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'printenv',
        summary: 'Print environment variables.',
        usage: 'printenv [name]',
        execute: async (args, ctx) => {
            const envMap = ctx.env || {};
            if (!args[1]) {
                const lines = Object.keys(envMap).map((key) => `${key}=${envMap[key]}`);
                return { output: formatOutput(lines, ctx), status: 0 };
            }
            const key = args[1];
            if (!Object.prototype.hasOwnProperty.call(envMap, key)) return { output: '', status: 0 };
            return { output: String(envMap[key]), status: 0 };
        }
    });

    registerCommand({
        name: 'export',
        summary: 'Set environment variables.',
        usage: 'export NAME=value | export NAME value',
        execute: async (args, ctx) => {
            if (!args[1]) return errorResult(ctx, 'Missing name');
            const config = await readConfig();
            let name = args[1];
            let value = args.slice(2).join(' ');
            if (name.includes('=')) {
                const parts = name.split('=');
                name = parts[0];
                value = parts.slice(1).join('=') || '';
            }
            if (!value && ctx && ctx.env && Object.prototype.hasOwnProperty.call(ctx.env, name)) {
                value = String(ctx.env[name]);
            }
            config[name] = value;
            await writeConfig(config);
            if (ctx && ctx.env) ctx.env[name] = value;
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'unset',
        summary: 'Unset environment variables.',
        usage: 'unset NAME',
        execute: async (args, ctx) => {
            if (!args[1]) return errorResult(ctx, 'Missing name');
            const config = await readConfig();
            delete config[args[1]];
            await writeConfig(config);
            if (ctx && ctx.env) delete ctx.env[args[1]];
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'mv',
        summary: 'Rename or move a file.',
        usage: 'mv <oldname> <newname>',
        execute: (args, ctx) => {
            if (!args[1] || !args[2]) {
                return { output: '', status: 1 };
            }
            const srcPath = ctx.resolvePath(args[1]);
            const destPath = ctx.resolvePath(args[2]);
            ctx.vfs.mv(srcPath, destPath);
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'cp',
        summary: 'Copy files and directories.',
        usage: 'cp [-r] <source> <dest>',
        execute: async (args, ctx) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-r': 'recursive', '-R': 'recursive' },
                defaults: { recursive: false }
            });
            const recursive = parsed.options.recursive;
            const srcArg = parsed.rest[0] || null;
            const destArg = parsed.rest[1] || null;
            if (!srcArg || !destArg) return { output: '', status: 1 };
            const srcPath = ctx.resolvePath(srcArg);
            const destPath = ctx.resolvePath(destArg);
            const srcIsDir = srcPath.endsWith('/');
            const destIsDir = destPath.endsWith('/');
            if (srcIsDir || destIsDir) {
                if (!srcIsDir && destIsDir) {
                    const targetDir = ctx.ensureDirPath(destPath);
                    if (!await ctx.dirExists(targetDir)) {
                        return errorResult(ctx, 'Invalid directory');
                    }
                    const baseName = srcArg.split('/').filter(Boolean).pop() || srcArg;
                    const targetPath = `${targetDir}${baseName}`;
                    try {
                        const content = await ctx.vfs.get(srcPath);
                        if (typeof content !== 'string') {
                            return errorResult(ctx, `${srcArg} is not a file`);
                        }
                        await ctx.vfs.put(targetPath, content);
                        return { output: '', status: 0 };
                    } catch (error) {
                        return errorResult(ctx, `${srcArg} is not a file`);
                    }
                }
                if (!recursive) {
                    return errorResult(ctx, 'Use -r for directories');
                }
                const base = ctx.ensureDirPath(srcPath);
                const destBase = ctx.ensureDirPath(destPath);
                try {
                    const { files, dirs } = await collectTreePaths('/');
                    for (let dir of dirs) {
                        if (!dir.startsWith(base)) continue;
                        const relative = dir.slice(base.length);
                        if (!relative) continue;
                        await ctx.vfs.put(destBase + relative, '');
                    }
                    for (let file of files) {
                        if (!file.startsWith(base)) continue;
                        const relative = file.slice(base.length);
                        const content = await ctx.vfs.get(file);
                        await ctx.vfs.put(destBase + relative, content);
                    }
                    return { output: '', status: 0 };
                } catch (error) {
                    return errorResult(ctx, 'Invalid directory');
                }
            }
            try {
                const content = await ctx.vfs.get(srcPath);
                if (typeof content !== 'string') {
                    return errorResult(ctx, '' + srcArg + ' is not a file');
                }
                ctx.vfs.put(destPath, content);
                return { output: '', status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + srcArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'rm',
        summary: 'Remove files or directories.',
        usage: 'rm [-r] <path>',
        execute: async (args, ctx) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-r': 'recursive', '-R': 'recursive', '-f': 'force' },
                defaults: { recursive: false, force: false }
            });
            const recursive = parsed.options.recursive;
            const force = parsed.options.force;
            const targetArg = parsed.rest[0];
            if (!targetArg) {
                return { output: '', status: 1 };
            }
            if (hasGlobChars(targetArg)) {
                const slashIndex = targetArg.lastIndexOf('/');
                const baseArg = slashIndex >= 0 ? targetArg.slice(0, slashIndex) : '';
                const pattern = slashIndex >= 0 ? targetArg.slice(slashIndex + 1) : targetArg;
                const basePath = baseArg ? ctx.ensureDirPath(ctx.resolvePath(baseArg)) : ctx.getCurrentPath();
                const matches = (await listImmediateEntries(basePath, ctx.vfs))
                    .filter((entry) => matchGlob(entry.name, pattern));
                if (!matches.length) {
                    return force ? { output: '', status: 0 } : errorResult(ctx, 'No matches found');
                }
                const removeDirTree = async (dirPath) => {
                    const base = ctx.ensureDirPath(dirPath);
                    const { files, dirs } = await collectTreePaths('/');
                    for (let file of files) {
                        if (file.startsWith(base)) ctx.vfs.rm(file);
                    }
                    const dirsToRemove = dirs.filter((dir) => dir.startsWith(base)).sort((a, b) => b.length - a.length);
                    dirsToRemove.forEach((dir) => ctx.vfs.rm(dir));
                    ctx.vfs.rm(base);
                };
                for (let match of matches) {
                    const targetPath = basePath === '/' ? `/${match.name}` : `${basePath}${match.name}`;
                    if (match.isDir) {
                        if (!recursive) {
                            if (!force) return errorResult(ctx, 'Use -r for directories');
                            continue;
                        }
                        try {
                            await removeDirTree(targetPath);
                        } catch (error) {
                            if (!force) return errorResult(ctx, 'Invalid directory');
                        }
                        continue;
                    }
                    try {
                        ctx.vfs.rm(targetPath);
                    } catch (error) {
                        if (!force) return errorResult(ctx, `${match.name} is not a file`);
                    }
                }
                return { output: '', status: 0 };
            }
            const targetPath = ctx.resolvePath(targetArg);
            if (!targetPath.endsWith('/')) {
                if (recursive) {
                    try {
                        await ctx.vfs.get(targetPath);
                        ctx.vfs.rm(targetPath);
                        return { output: '', status: 0 };
                    } catch (error) {
                        // fall through to directory removal
                    }
                } else {
                    try {
                        ctx.vfs.rm(targetPath);
                        return { output: '', status: 0 };
                    } catch (error) {
                        if (force) {
                            return { output: '', status: 0 };
                        }
                        return errorResult(ctx, '' + targetArg + ' is not a file');
                    }
                }
            }
            if (!recursive) {
                if (force) {
                    return { output: '', status: 0 };
                }
                return errorResult(ctx, 'Use -r for directories');
            }
            const base = ctx.ensureDirPath(targetPath);
            try {
                const { files, dirs } = await collectTreePaths('/');
                for (let file of files) {
                    if (file.startsWith(base)) ctx.vfs.rm(file);
                }
                const dirsToRemove = dirs.filter((dir) => dir.startsWith(base)).sort((a, b) => b.length - a.length);
                dirsToRemove.forEach((dir) => ctx.vfs.rm(dir));
                ctx.vfs.rm(base);
                return { output: '', status: 0 };
            } catch (error) {
                if (force) {
                    return { output: '', status: 0 };
                }
                return errorResult(ctx, 'Invalid directory');
            }
        }
    });

    registerCommand({
        name: 'less',
        summary: 'Display the contents of a file.',
        usage: 'less <file>',
        execute: async (args, ctx) => {
            if (!args[1]) {
                return errorResult(ctx, 'No file given');
            }
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
            try {
                const content = await ctx.vfs.get(path);
                return {
                    output: typeof content === 'string' ? formatOutput(content, ctx) : '',
                    status: 0
                };
            } catch (error) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'cat',
        summary: 'Concatenate and print files.',
        usage: 'cat <file>',
        execute: async (args, ctx, input) => {
            if (!args[1] && ctx.hasInput) {
                return { output: formatOutput(input, ctx), status: 0 };
            }
            if (!args[1]) {
                return errorResult(ctx, 'No file given');
            }
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
            try {
                const content = await readFileContent(path, ctx);
                return { output: formatOutput(content, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'more',
        summary: 'Display the contents of a file.',
        usage: 'more <file>',
        execute: async (args, ctx) => {
            if (!args[1]) {
                return errorResult(ctx, 'No file given');
            }
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
            try {
                const content = await readFileContent(path, ctx);
                return { output: formatOutput(content, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'head',
        summary: 'Output the first part of files.',
        usage: 'head [-n N] [-c N] <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                value: { '-n': 'count', '-c': 'bytes' },
                defaults: { count: '10', bytes: null }
            });
            const count = Number(parsed.options.count);
            const byteCount = parsed.options.bytes !== null ? Number(parsed.options.bytes) : null;
            const fileArg = parsed.rest[0] || null;
            if (!fileArg && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                if (byteCount !== null) {
                    const normalizedBytes = Number.isFinite(byteCount) && byteCount >= 0 ? Math.floor(byteCount) : 0;
                    return { output: formatOutput(content.slice(0, normalizedBytes), ctx), status: 0 };
                }
                const normalizedCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 10;
                const lines = splitLines(content);
                return { output: formatOutput(lines.slice(0, normalizedCount), ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'tail',
        summary: 'Output the last part of files.',
        usage: 'tail [-n N] [-c N] <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                value: { '-n': 'count', '-c': 'bytes' },
                defaults: { count: '10', bytes: null }
            });
            const count = Number(parsed.options.count);
            const byteCount = parsed.options.bytes !== null ? Number(parsed.options.bytes) : null;
            const fileArg = parsed.rest[0] || null;
            if (!fileArg && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                if (byteCount !== null) {
                    const normalizedBytes = Number.isFinite(byteCount) && byteCount >= 0 ? Math.floor(byteCount) : 0;
                    if (normalizedBytes === 0) {
                        return { output: '', status: 0 };
                    }
                    return { output: formatOutput(content.slice(-normalizedBytes), ctx), status: 0 };
                }
                const normalizedCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 10;
                const lines = splitLines(content);
                if (normalizedCount === 0) {
                    return { output: '', status: 0 };
                }
                return { output: formatOutput(lines.slice(-normalizedCount), ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'wc',
        summary: 'Print newline, word, and byte counts.',
        usage: 'wc [-l] [-w] [-c] <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-l': 'lines', '-w': 'words', '-c': 'bytes' },
                defaults: { lines: false, words: false, bytes: false }
            });
            let showLines = parsed.options.lines;
            let showWords = parsed.options.words;
            let showBytes = parsed.options.bytes;
            const fileArg = parsed.rest[0] || null;
            if (!fileArg && !ctx.hasInput) return errorResult(ctx, 'No file given');
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lineCount = (content.match(/\r?\n/g) || []).length;
                const wordCount = (content.match(/\S+/g) || []).length;
                const byteCount = content.length;
                if (!showLines && !showWords && !showBytes) {
                    showLines = true;
                    showWords = true;
                    showBytes = true;
                }
                const parts = [];
                if (showLines) parts.push(lineCount.toString());
                if (showWords) parts.push(wordCount.toString());
                if (showBytes) parts.push(byteCount.toString());
                if (fileArg) parts.push(fileArg);
                return { output: parts.join(' '), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'grep',
        summary: 'Search for a pattern in a file.',
        usage: 'grep [-i] [-n] [-v] <pattern> <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-i': 'ignoreCase', '-n': 'lineNumbers', '-v': 'invert' },
                defaults: { ignoreCase: false, lineNumbers: false, invert: false }
            });
            const flags = parsed.options.ignoreCase ? 'i' : '';
            const showLineNumbers = parsed.options.lineNumbers;
            const invertMatch = parsed.options.invert;
            if (parsed.rest.length < 1) return errorResult(ctx, 'Missing pattern');
            const pattern = stripQuotes(parsed.rest[0]);
            const fileArg = parsed.rest[1];
            let regex;
            try {
                regex = new RegExp(pattern, flags);
            } catch (error) {
                return errorResult(ctx, 'Invalid pattern');
            }
            try {
                if (!fileArg && !ctx.hasInput) return errorResult(ctx, 'Missing file');
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const matches = [];
                lines.forEach((line, index) => {
                    const isMatch = regex.test(line);
                    if (invertMatch ? !isMatch : isMatch) {
                        matches.push(showLineNumbers ? `${index + 1}:${line}` : line);
                    }
                });
                return { output: formatOutput(matches, ctx), status: matches.length ? 0 : 1 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'find',
        summary: 'Search for files by pattern.',
        usage: 'find [path] <pattern>',
        execute: async (args, ctx) => {
            if (!args[1]) {
                return errorResult(ctx, 'Missing pattern');
            }
            let baseArg = null;
            let patternArg = null;
            let nameOnly = false;
            if (args[1] === '-name' && args[2]) {
                patternArg = args[2];
                nameOnly = true;
            } else if (args[2] === '-name' && args[3]) {
                baseArg = args[1];
                patternArg = args[3];
                nameOnly = true;
            } else if (args[2]) {
                baseArg = args[1];
                patternArg = args[2];
            } else {
                patternArg = args[1];
            }
            const basePath = baseArg ? ctx.ensureDirPath(ctx.resolvePath(baseArg)) : ctx.getCurrentPath();
            const basePrefix = baseArg && !baseArg.startsWith('/') ? ctx.ensureDirPath(baseArg) : null;
            let regex;
            try {
                const pattern = stripQuotes(patternArg);
                regex = nameOnly ? new RegExp(`^${globToRegex(pattern)}$`) : new RegExp(pattern);
            } catch (error) {
                return errorResult(ctx, 'Invalid pattern');
            }
            try {
                const entries = await listEntries(basePath, ctx.vfs);
                let matches = entries
                    .filter((entry) => {
                        if (!nameOnly) return regex.test(entry);
                        const name = entry.split('/').filter(Boolean).pop() || '';
                        return regex.test(name);
                    })
                    .map((entry) => {
                        if (basePrefix) return `${basePrefix}${entry}`;
                        return basePath === '/' ? `/${entry}` : `${basePath}${entry}`;
                    });
                return { output: formatOutput(matches, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Invalid directory');
            }
        }
    });

    registerCommand({
        name: 'sort',
        summary: 'Sort lines of text.',
        usage: 'sort [-r] [-n] [-k N] <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-r': 'descending', '-n': 'numeric' },
                value: { '-k': 'keyIndex' },
                defaults: { descending: false, numeric: false, keyIndex: null }
            });
            const descending = parsed.options.descending;
            const numeric = parsed.options.numeric;
            const keyIndex = parsed.options.keyIndex ? Number(parsed.options.keyIndex) : null;
            const fileArg = parsed.rest[0] || null;
            if (!fileArg && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const getKey = (line) => {
                    if (!keyIndex || !Number.isFinite(keyIndex) || keyIndex < 1) return line;
                    const parts = line.split(/\s+/);
                    return parts[keyIndex - 1] || '';
                };
                if (numeric) {
                    lines.sort((a, b) => {
                        const left = parseFloat(getKey(a));
                        const right = parseFloat(getKey(b));
                        const leftValue = Number.isFinite(left) ? left : 0;
                        const rightValue = Number.isFinite(right) ? right : 0;
                        if (leftValue === rightValue) return a.localeCompare(b);
                        return leftValue - rightValue;
                    });
                } else {
                    lines.sort((a, b) => getKey(a).localeCompare(getKey(b)) || a.localeCompare(b));
                }
                if (descending) lines.reverse();
                return { output: formatOutput(lines, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'cut',
        summary: 'Remove sections from each line.',
        usage: 'cut -d <delimiter> -f <list> [file] | cut -b <list> [file]',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                value: { '-d': 'delimiter', '-f': 'fields', '-b': 'bytes' },
                defaults: { delimiter: '\t', fields: null, bytes: null }
            });
            const delimiter = decodeEscapes(stripQuotes(parsed.options.delimiter));
            const fields = parsed.options.fields;
            const bytes = parsed.options.bytes;
            const fileArg = parsed.rest[0] || null;
            if (fields && bytes) {
                return errorResult(ctx, 'Invalid options');
            }
            if (!fields && !bytes) {
                return errorResult(ctx, 'Missing field list');
            }
            if (!fileArg && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            const buildIndexSet = (list) => {
                const set = new Set();
                list.split(',').forEach((part) => {
                    const range = part.split('-').map((value) => parseInt(value, 10));
                    if (range.length === 1 && Number.isFinite(range[0])) {
                        set.add(range[0]);
                    } else if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
                        for (let i = range[0]; i <= range[1]; i++) set.add(i);
                    }
                });
                return set;
            };
            const fieldSet = fields ? buildIndexSet(fields) : null;
            const byteSet = bytes ? buildIndexSet(bytes) : null;
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const output = lines.map((line) => {
                    if (byteSet) {
                        const chars = line.split('');
                        return chars.filter((char, index) => byteSet.has(index + 1)).join('');
                    }
                    const parts = line.split(delimiter);
                    const selected = parts.filter((part, index) => fieldSet.has(index + 1));
                    return selected.join(delimiter);
                });
                return { output: formatOutput(output, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'paste',
        summary: 'Merge lines of files.',
        usage: 'paste [file...]',
        execute: async (args, ctx, input) => {
            const fileArgs = args.slice(1);
            if (fileArgs.length === 0 && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            const streams = [];
            if (ctx.hasInput) {
                streams.push(splitLines(input));
            }
            for (let i = 0; i < fileArgs.length; i++) {
                const path = ctx.resolvePath(fileArgs[i]);
                try {
                    const content = await readFileContent(path, ctx);
                    streams.push(splitLines(content));
                } catch (error) {
                    return errorResult(ctx, '' + fileArgs[i] + ' is not a file');
                }
            }
            if (streams.length === 0) {
                return { output: '', status: 0 };
            }
            const maxLines = Math.max(...streams.map((stream) => stream.length));
            const output = [];
            for (let i = 0; i < maxLines; i++) {
                const row = streams.map((stream) => (stream[i] !== undefined ? stream[i] : '')).join('\t');
                output.push(row);
            }
            return { output: formatOutput(output, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'tr',
        summary: 'Translate or delete characters.',
        usage: 'tr [-d] <set1> [set2]',
        execute: async (args, ctx, input) => {
            if (!ctx.hasInput) {
                return errorResult(ctx, 'No input');
            }
            const parsed = parseCommandOptions(args, {
                boolean: { '-d': 'deleteMode', '-s': 'squeezeMode' },
                defaults: { deleteMode: false, squeezeMode: false }
            });
            const deleteMode = parsed.options.deleteMode;
            const squeezeMode = parsed.options.squeezeMode;
            let set1 = parsed.rest[0] || null;
            let set2 = parsed.rest[1] || null;
            if (!set1) {
                return errorResult(ctx, 'Missing set');
            }
            const sourceSet = expandCharSet(decodeEscapes(stripQuotes(set1)));
            if (!deleteMode && !set2) {
                set2 = set1;
            }
            const targetSet = deleteMode ? '' : expandCharSet(decodeEscapes(stripQuotes(set2 || '')));
            if (deleteMode) {
                const remove = new Set(sourceSet.split(''));
                let output = input.split('').filter((char) => !remove.has(char)).join('');
                if (squeezeMode) {
                    const squeezeSet = new Set(sourceSet.split(''));
                    let squeezed = '';
                    let lastChar = null;
                    for (let i = 0; i < output.length; i++) {
                        const char = output[i];
                        if (squeezeSet.has(char) && char === lastChar) continue;
                        squeezed += char;
                        lastChar = char;
                    }
                    output = squeezed;
                }
                return { output: formatOutput(output, ctx), status: 0 };
            }
            const map = new Map();
            for (let i = 0; i < sourceSet.length; i++) {
                map.set(sourceSet[i], targetSet[i] !== undefined ? targetSet[i] : targetSet[targetSet.length - 1] || '');
            }
            let output = input.split('').map((char) => (map.has(char) ? map.get(char) : char)).join('');
            if (squeezeMode) {
                const squeezeSet = new Set((set2 ? targetSet : sourceSet).split(''));
                let squeezed = '';
                let lastChar = null;
                for (let i = 0; i < output.length; i++) {
                    const char = output[i];
                    if (squeezeSet.has(char) && char === lastChar) continue;
                    squeezed += char;
                    lastChar = char;
                }
                output = squeezed;
            }
            return { output: formatOutput(output, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'curl',
        summary: 'Transfer data from or to a server.',
        usage: 'curl [-X METHOD] [-H HEADER] [-d DATA] [-o FILE] <url>',
        execute: async (args, ctx) => {
            let method = 'GET';
            let data = null;
            let outputFile = null;
            const headers = {};
            let url = null;
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg === '-X' && args[i + 1]) {
                    method = args[i + 1].toUpperCase();
                    i += 1;
                    continue;
                }
                if (arg === '-H' && args[i + 1]) {
                    const header = stripQuotes(args[i + 1]);
                    const [name, ...rest] = header.split(':');
                    if (name) headers[name.trim()] = rest.join(':').trim();
                    i += 1;
                    continue;
                }
                if (arg === '-d' && args[i + 1]) {
                    data = stripQuotes(args[i + 1]);
                    if (data.startsWith('@')) {
                        const filePath = ctx.resolvePath(data.slice(1));
                        try {
                            const fileContent = await ctx.vfs.get(filePath);
                            data = typeof fileContent === 'string' ? fileContent : new TextDecoder().decode(fileContent);
                        } catch (error) {
                            return errorResult(ctx, 'Unable to read data file');
                        }
                    }
                    if (method === 'GET') method = 'POST';
                    i += 1;
                    continue;
                }
                if (arg === '-o' && args[i + 1]) {
                    outputFile = args[i + 1];
                    i += 1;
                    continue;
                }
                if (!url) url = arg;
            }
            if (!url) return errorResult(ctx, 'Missing URL');
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: data
                });
                if (!response.ok) {
                    return errorResult(ctx, `HTTP ${response.status}`);
                }
                if (outputFile) {
                    const buffer = await response.arrayBuffer();
                    await ctx.vfs.put(ctx.resolvePath(outputFile), buffer);
                    return { output: '', status: 0 };
                }
                const text = await response.text();
                return { output: formatOutput(text, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Request failed');
            }
        }
    });

    registerCommand({
        name: 'wget',
        summary: 'Download files from the web.',
        usage: 'wget [-O file] <url>',
        execute: async (args, ctx) => {
            let outputFile = null;
            let url = null;
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg === '-O' && args[i + 1]) {
                    outputFile = args[i + 1];
                    i += 1;
                    continue;
                }
                if (!url) url = arg;
            }
            if (!url) return errorResult(ctx, 'Missing URL');
            const fallbackName = url.split('/').filter(Boolean).pop() || 'index.html';
            const target = outputFile || fallbackName;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    return errorResult(ctx, `HTTP ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                await ctx.vfs.put(ctx.resolvePath(target), buffer);
                return { output: '', status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Request failed');
            }
        }
    });

    registerCommand({
        name: 'sh',
        summary: 'Run a shell script.',
        usage: 'sh <file>',
        execute: async (args, ctx) => {
            if (!args[1]) return errorResult(ctx, 'Missing file');
            try {
                const baseEnv = ctx.env || await getSessionEnv();
                const envMap = cloneEnv(baseEnv);
                const path = await resolveScriptPath(args[1], ctx, envMap) || ctx.resolvePath(args[1]);
                const content = await ctx.vfs.get(path);
                const script = typeof content === 'string' ? content : new TextDecoder().decode(content);
                const result = await runShellScript(script, ctx, envMap);
                if (result && typeof result === 'object') return result;
                if (typeof result === 'string') return { output: result, status: 0 };
                return { output: '', status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Unable to read script');
            }
        }
    });

    registerCommand({
        name: 'source',
        summary: 'Run a script in the current shell.',
        usage: 'source <file>',
        execute: async (args, ctx) => {
            if (!args[1]) return errorResult(ctx, 'Missing file');
            try {
                const envMap = ctx.env || await getSessionEnv();
                const path = await resolveScriptPath(args[1], ctx, envMap) || ctx.resolvePath(args[1]);
                const content = await ctx.vfs.get(path);
                const script = typeof content === 'string' ? content : new TextDecoder().decode(content);
                const result = await runShellScript(script, ctx, envMap);
                if (result && typeof result === 'object') return result;
                if (typeof result === 'string') return { output: result, status: 0 };
                return { output: '', status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Unable to read script');
            }
        }
    });

    registerCommand({
        name: '.',
        summary: 'Run a script in the current shell.',
        usage: '. <file>',
        execute: async (args, ctx) => {
            return await commandMap.get('source').execute(args, ctx);
        }
    });

    registerCommand({
        name: 'uniq',
        summary: 'Report or filter repeated lines.',
        usage: 'uniq [-c] [-d] [-u] <file>',
        execute: async (args, ctx, input) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-c': 'counts', '-d': 'duplicates', '-u': 'uniques' },
                defaults: { counts: false, duplicates: false, uniques: false }
            });
            const showCounts = parsed.options.counts;
            const onlyDuplicates = parsed.options.duplicates;
            const onlyUniques = parsed.options.uniques;
            const fileArg = parsed.rest[0] || null;
            if (onlyDuplicates && onlyUniques) {
                return errorResult(ctx, 'Invalid flags');
            }
            if (!fileArg && !ctx.hasInput) {
                return errorResult(ctx, 'No file given');
            }
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const output = [];
                let last = null;
                let count = 0;
                const flush = () => {
                    if (last === null) return;
                    if (onlyDuplicates && count < 2) return;
                    if (onlyUniques && count !== 1) return;
                    output.push(showCounts ? `${count} ${last}` : last);
                };
                lines.forEach((line) => {
                    if (line === last) {
                        count += 1;
                        return;
                    }
                    flush();
                    last = line;
                    count = 1;
                });
                flush();
                return { output: formatOutput(output, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'sed',
        summary: 'Stream editor for basic substitutions.',
        usage: 'sed <script> <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) {
                return errorResult(ctx, 'Missing script');
            }
            const script = stripQuotes(args[1]);
            const fileArg = args[2];
            if (!script.startsWith('s')) {
                return errorResult(ctx, 'Only substitution scripts are supported');
            }
            const delimiter = script[1];
            if (!delimiter) {
                return errorResult(ctx, 'Invalid script');
            }
            const parseSegment = (startIndex) => {
                let current = '';
                let i = startIndex;
                while (i < script.length) {
                    const char = script[i];
                    if (char === '\\' && i + 1 < script.length) {
                        current += script[i + 1];
                        i += 2;
                        continue;
                    }
                    if (char === delimiter) {
                        return { value: current, nextIndex: i + 1 };
                    }
                    current += char;
                    i += 1;
                }
                return null;
            };
            const patternSegment = parseSegment(2);
            if (!patternSegment) {
                return errorResult(ctx, 'Invalid script');
            }
            const replacementSegment = parseSegment(patternSegment.nextIndex);
            if (!replacementSegment) {
                return errorResult(ctx, 'Invalid script');
            }
            const flags = script.slice(replacementSegment.nextIndex);
            let regex;
            try {
                const regexFlags = `${flags.includes('g') ? 'g' : ''}${flags.includes('i') ? 'i' : ''}`;
                regex = new RegExp(patternSegment.value, regexFlags);
            } catch (error) {
                return errorResult(ctx, 'Invalid pattern');
            }
            try {
                if (!fileArg && !ctx.hasInput) {
                    return errorResult(ctx, 'Missing file');
                }
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                return {
                    output: formatOutput(content.replace(regex, replacementSegment.value), ctx),
                    status: 0
                };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'awk',
        summary: 'Pattern scanning and processing.',
        usage: 'awk <script> <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) {
                return errorResult(ctx, 'Missing script');
            }
            const script = stripQuotes(args[1]);
            const fileArg = args[2];
            const printMatch = script.match(/print\s+(.+)/);
            if (!printMatch) {
                return errorResult(ctx, 'Only print scripts are supported');
            }
            let fieldsPart = printMatch[1].trim();
            fieldsPart = fieldsPart.replace(/^\{|\}$/g, '').trim();
            const fields = fieldsPart.split(/\s*,\s*/).filter(Boolean);
            try {
                if (!fileArg && !ctx.hasInput) {
                    return errorResult(ctx, 'Missing file');
                }
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const output = lines.map((line) => {
                    if (fields.length === 1 && fields[0] === '$0') return line;
                    const parts = line.split(/\s+/);
                    const rendered = fields.map((field) => {
                        const trimmed = field.trim();
                        const quoted = stripQuotes(trimmed);
                        if (quoted !== trimmed) return quoted;
                        if (trimmed.startsWith('$')) {
                            const index = Number(trimmed.slice(1));
                            if (Number.isFinite(index) && index > 0) {
                                return parts[index - 1] || '';
                            }
                            if (trimmed === '$0') return line;
                        }
                        return trimmed;
                    });
                    return rendered.join(' ');
                });
                return { output: formatOutput(output, ctx), status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + fileArg + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'tee',
        summary: 'Read from stdin and write to stdout and files.',
        usage: 'tee <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) return errorResult(ctx, 'Missing file');
            if (!ctx.hasInput) return errorResult(ctx, 'No input');
            const path = ctx.resolvePath(args[1]);
            try {
                await ctx.vfs.put(path, input);
            } catch (error) {
                return errorResult(ctx, 'Unable to write file');
            }
            return { output: formatOutput(input, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'xargs',
        summary: 'Build and execute command lines from input.',
        usage: 'xargs <command> [args...]',
        execute: async (args, ctx, input) => {
            if (!ctx.hasInput) return errorResult(ctx, 'No input');
            const commandName = args[1] || 'echo';
            if (!commandMap.has(commandName)) return errorResult(ctx, 'Invalid command');
            const baseArgs = args.slice(2);
            const handler = commandMap.get(commandName);
            const lines = splitLines(input).filter((line) => line !== '');
            const outputs = [];
            let lastStatus = 0;
            for (let i = 0; i < lines.length; i++) {
                const lineArg = lines[i];
                const lineArgs = [commandName].concat(baseArgs, lineArg);
                const output = await handler.execute(lineArgs, { ...ctx, outputMode: 'text', hasInput: true }, lineArg);
                if (output && typeof output === 'object') {
                    if (Object.prototype.hasOwnProperty.call(output, 'status')) {
                        lastStatus = output.status;
                    }
                    if (typeof output.output === 'string' && output.output !== '') {
                        outputs.push(output.output);
                    }
                } else if (typeof output === 'string' && output !== '') {
                    outputs.push(output);
                }
            }
            return { output: formatOutput(outputs.join('\n'), ctx), status: lastStatus };
        }
    });

    registerCommand({
        name: 'diff',
        summary: 'Compare files line by line.',
        usage: 'diff <file1> <file2>',
        execute: async (args, ctx) => {
            if (!args[1] || !args[2]) {
                return errorResult(ctx, 'Missing file');
            }
            const leftArg = args[1];
            const rightArg = args[2];
            const leftPath = ctx.resolvePath(leftArg);
            const rightPath = ctx.resolvePath(rightArg);
            try {
                const leftContent = await readFileContent(leftPath, ctx);
                const rightContent = await readFileContent(rightPath, ctx);
                if (leftContent === rightContent) {
                    return { output: '', status: 0 };
                }
                const leftLines = splitLines(leftContent);
                const rightLines = splitLines(rightContent);
                const maxLines = Math.max(leftLines.length, rightLines.length);
                const output = [];
                let changed = false;
                for (let i = 0; i < maxLines; i++) {
                    const leftLine = leftLines[i];
                    const rightLine = rightLines[i];
                    if (leftLine === rightLine) {
                        if (leftLine !== undefined) output.push(`  ${leftLine}`);
                        continue;
                    }
                    changed = true;
                    if (leftLine !== undefined) output.push(`- ${leftLine}`);
                    if (rightLine !== undefined) output.push(`+ ${rightLine}`);
                }
                return {
                    output: ctx.outputMode === 'text' ? output.join('\n') : `<pre>${output.join('\n')}</pre>`,
                    status: changed ? 1 : 0
                };
            } catch (error) {
                return errorResult(ctx, 'One or both files are invalid');
            }
        }
    });

    registerCommand({
        name: 'echo',
        summary: 'Display a line of text.',
        usage: 'echo [text]',
        execute: (args, ctx) => {
            const text = args.slice(1).join(' ');
            if (ctx && ctx.outputMode === 'text') return { output: text + '\n', status: 0 };
            return { output: text, status: 0 };
        }
    });

    registerCommand({
        name: 'printf',
        summary: 'Format and print data.',
        usage: 'printf <format> [args...]',
        execute: (args, ctx, input) => {
            let format = args[1] || '';
            if (!format && ctx.hasInput) {
                return { output: formatOutput(input, ctx), status: 0 };
            }
            format = decodeEscapes(stripQuotes(format));
            const values = args.slice(2);
            let valueIndex = 0;
            const output = format.replace(/%([-0]?)(\d*)(?:\.(\d+))?([sdif%])/g, (match, flag, widthText, precisionText, type) => {
                if (type === '%') return '%';
                const value = values[valueIndex++] || '';
                const width = widthText ? parseInt(widthText, 10) : 0;
                const precision = precisionText ? parseInt(precisionText, 10) : null;
                if (type === 'd' || type === 'i') {
                    const numberValue = parseInt(value, 10);
                    let rendered = Number.isFinite(numberValue) ? numberValue.toString() : '0';
                    if (precision !== null) rendered = rendered.padStart(precision, '0');
                    if (width) {
                        const padChar = flag === '0' ? '0' : ' ';
                        rendered = flag === '-' ? rendered.padEnd(width, ' ') : rendered.padStart(width, padChar);
                    }
                    return rendered;
                }
                if (type === 'f') {
                    const floatValue = parseFloat(value);
                    let rendered = Number.isFinite(floatValue) ? floatValue.toString() : '0';
                    if (precision !== null && Number.isFinite(floatValue)) {
                        rendered = floatValue.toFixed(precision);
                    }
                    if (width) {
                        const padChar = flag === '0' ? '0' : ' ';
                        rendered = flag === '-' ? rendered.padEnd(width, ' ') : rendered.padStart(width, padChar);
                    }
                    return rendered;
                }
                let rendered = value;
                if (precision !== null) rendered = rendered.slice(0, precision);
                if (width) {
                    rendered = flag === '-' ? rendered.padEnd(width, ' ') : rendered.padStart(width, ' ');
                }
                return rendered;
            });
            return { output: formatOutput(output, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'history',
        summary: 'Display command history.',
        usage: 'history',
        execute: (args, ctx) => {
            const lines = history.map((entry, index) => `${index + 1}  ${entry}`);
            return { output: formatOutput(lines, ctx), status: 0 };
        }
    });

    registerCommand({
        name: 'date',
        summary: 'Display the current date and time.',
        usage: 'date',
        execute: () => ({ output: new Date().toString(), status: 0 })
    });

    registerCommand({
        name: 'df',
        summary: 'Report file system disk space usage.',
        usage: 'df',
        execute: async (args, ctx) => {
            try {
                const estimate = await ctx.vfs.df();
                const quota = estimate.quota || 0;
                const usage = estimate.usage || 0;
                const avail = estimate.available || Math.max(0, quota - usage);
                const usePct = quota ? `${Math.round((usage / quota) * 100)}%` : '0%';
                const formatBytes = (value) => {
                    if (!value) return '0B';
                    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                    let size = value;
                    let unitIndex = 0;
                    while (size >= 1024 && unitIndex < units.length - 1) {
                        size /= 1024;
                        unitIndex += 1;
                    }
                    return `${size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size)}${units[unitIndex]}`;
                };
                const headers = ['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on'];
                const values = ['vfs', formatBytes(quota), formatBytes(usage), formatBytes(avail), usePct, '/'];
                if (ctx.outputMode === 'text') {
                    const colWidths = headers.map((header, index) =>
                        Math.max(header.length, values[index].length)
                    );
                    const renderRow = (cols) => cols
                        .map((col, index) => col.padEnd(colWidths[index]))
                        .join('  ');
                    return { output: `${renderRow(headers)}\n${renderRow(values)}`, status: 0 };
                }
                const renderCells = (cells, cellTag) =>
                    cells.map((cell) => `<${cellTag} style="padding-right: 12px; text-align: left;">${cell}</${cellTag}>`).join('');
                return {
                    output: `<table style="border-collapse: collapse; font-family: monospace;"><tr>${renderCells(headers, 'th')}</tr><tr>${renderCells(values, 'td')}</tr></table>`,
                    status: 0
                };
            } catch (error) {
                return errorResult(ctx, 'Storage estimate not available');
            }
        }
    });

    registerCommand({
        name: 'sleep',
        summary: 'Delay for a specified amount of time.',
        usage: 'sleep <seconds>',
        execute: async (args) => {
            const seconds = Number(args[1]);
            const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
            if (!delay) return { output: '', status: 0 };
            await new Promise((resolve) => setTimeout(resolve, delay));
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'ls',
        summary: 'List directory contents.',
        usage: 'ls',
        execute: async (args, ctx) => {
            try {
                const targetArg = args[1] || '';
                if (!targetArg) {
                    const children = await ctx.listChildren(ctx.getCurrentPath());
                    return { output: formatOutput(children, ctx), status: 0 };
                }
                if (hasGlobChars(targetArg)) {
                    const slashIndex = targetArg.lastIndexOf('/');
                    const baseArg = slashIndex >= 0 ? targetArg.slice(0, slashIndex) : '';
                    const pattern = slashIndex >= 0 ? targetArg.slice(slashIndex + 1) : targetArg;
                    const basePath = baseArg ? ctx.ensureDirPath(ctx.resolvePath(baseArg)) : ctx.getCurrentPath();
                    const matches = (await listImmediateEntries(basePath, ctx.vfs))
                        .filter((entry) => matchGlob(entry.name, pattern))
                        .map((entry) => entry.name);
                    return { output: formatOutput(matches, ctx), status: 0 };
                }
                const resolved = ctx.resolvePath(targetArg);
                if (resolved.endsWith('/')) {
                    const children = await ctx.listChildren(resolved);
                    return { output: formatOutput(children, ctx), status: 0 };
                }
                return { output: targetArg, status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Invalid directory');
            }
        }
    });

    registerCommand({
        name: 'pwd',
        summary: 'Print the name of the current working directory.',
        usage: 'pwd',
        execute: (args, ctx) => {
            return { output: ctx.getCurrentPath(), status: 0 };
        }
    });

    registerCommand({
        name: 'cd',
        summary: 'Change the current working directory.',
        usage: 'cd <path>',
        execute: async (args, ctx) => {
            let newPath = ctx.getCurrentPath();
            if (args[1] === '..') {
                newPath = ctx.getCurrentPath().split('/').filter(Boolean).slice(0, -1).join('/') || '/';
                newPath = ctx.ensureDirPath(newPath);
            } else if (args[1]) {
                newPath = ctx.ensureDirPath(ctx.resolvePath(args[1]));
            }
            if (await ctx.dirExists(newPath)) {
                ctx.setCurrentPath(newPath);
                return { output: '', status: 0 };
            }
            return errorResult(ctx, 'Invalid directory');
        }
    });

    registerCommand({
        name: 'mkdir',
        summary: 'Create a directory.',
        usage: 'mkdir <dir>',
        execute: async (args, ctx) => {
            const parsed = parseCommandOptions(args, {
                boolean: { '-p': 'recursive' },
                defaults: { recursive: false }
            });
            const recursive = parsed.options.recursive;
            const targetArg = parsed.rest[0] || null;
            if (!targetArg) return { output: '', status: 1 };
            const dirPath = ctx.ensureDirPath(ctx.resolvePath(targetArg));
            if (!recursive) {
                if (await ctx.dirExists(dirPath)) {
                    return errorResult(ctx, 'File exists');
                }
                ctx.vfs.put(dirPath, '');
                return { output: '', status: 0 };
            }
            const parts = dirPath.split('/').filter(Boolean);
            let current = '/';
            for (let i = 0; i < parts.length; i++) {
                current += parts[i] + '/';
                await ctx.vfs.put(current, '');
            }
            return { output: '', status: 0 };
        }
    });

    registerCommand({
        name: 'ln',
        summary: 'Create a link to a file.',
        usage: 'ln <target> <linkname>',
        execute: async (args, ctx) => {
            if (!args[1] || !args[2]) {
                return { output: '', status: 1 };
            }
            const targetPath = ctx.resolvePath(args[1]);
            const linkPath = ctx.resolvePath(args[2]);
            if (targetPath.endsWith('/') || linkPath.endsWith('/')) {
                return errorResult(ctx, 'Links to files only');
            }
            try {
                const content = await ctx.vfs.get(targetPath);
                if (typeof content !== 'string') {
                    return errorResult(ctx, '' + args[1] + ' is not a file');
                }
                await ctx.vfs.put(linkPath, content);
                return { output: '', status: 0 };
            } catch (error) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'stat',
        summary: 'Display file status.',
        usage: 'stat <file>',
        execute: async (args, ctx) => {
            if (!args[1]) {
                return errorResult(ctx, 'Missing file');
            }
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) {
                return errorResult(ctx, 'Invalid file');
            }
            try {
                const content = await ctx.vfs.get(path);
                const size = typeof content === 'string' ? content.length : content.byteLength || 0;
                return {
                    output: `File: ${args[1]}<br>Size: ${size} bytes<br>Type: file`,
                    status: 0
                };
            } catch (error) {
                return errorResult(ctx, '' + args[1] + ' is not a file');
            }
        }
    });

    registerCommand({
        name: 'test',
        summary: 'Check file, numeric, and string conditions.',
        usage: 'test -e <path> | test -f <file> | test -d <dir> | test <n1> -eq <n2> | test -z <str>',
        execute: async (args, ctx) => {
            const result = await evaluateTestExpression(args.slice(1), ctx, false);
            if (result.error) {
                return { output: result.error, status: 2 };
            }
            if (result.ok) {
                return { output: '', status: 0 };
            }
            return { output: '', status: 1 };
        }
    });

    registerCommand({
        name: '[',
        summary: 'Check file conditions.',
        usage: '[ -e <path> ] | [ -f <file> ] | [ -d <dir> ]',
        execute: async (args, ctx) => {
            const closing = args[args.length - 1];
            if (closing !== ']') {
                return errorResult(ctx, 'Missing ]');
            }
            const inner = args.slice(0, -1);
            return await commandMap.get('test').execute(inner, ctx);
        }
    });

    registerCommand({
        name: '[[',
        summary: 'Check file, numeric, and string conditions.',
        usage: '[[ <expr> ]]',
        execute: async (args, ctx) => {
            const closing = args[args.length - 1];
            if (closing !== ']]') {
                return errorResult(ctx, 'Missing ]]');
            }
            const tokens = args.slice(1, -1);
            if (!tokens.length) return errorResult(ctx, 'Missing operand');
            const expanded = tokens.map((token) => expandArg(token, ctx.env || {}));
            const result = await evaluateTestExpression(expanded, ctx, true);
            if (result.error) {
                return { output: result.error, status: 2 };
            }
            if (result.ok) {
                return { output: '', status: 0 };
            }
            return { output: '', status: 1 };
        }
    });

    registerCommand({
        name: 'rmdir',
        summary: 'Remove a directory.',
        usage: 'rmdir <dir>',
        execute: async (args, ctx) => {
            if (!args[1]) {
                return { output: '', status: 1 };
            }
            const dirPath = ctx.ensureDirPath(ctx.resolvePath(args[1]));
            const children = await ctx.listChildren(dirPath);
            if (children.length === 0) {
                ctx.vfs.rm(dirPath);
                return { output: '', status: 0 };
            }
            return { output: '', status: 1 };
        }
    });

    registerCommand({
        name: 'tree',
        summary: 'Display directory tree.',
        usage: 'tree',
        execute: async (args, ctx) => {
            const entries = await ctx.vfs.ls('/');
            const root = {};
            for (let entry of entries) {
                if (!entry) continue;
                if (entry.startsWith('/')) entry = entry.slice(1);
                const isDir = entry.endsWith('/');
                const parts = entry.split('/').filter(Boolean);
                let node = root;
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const isLast = i === parts.length - 1;
                    if (isLast && !isDir) {
                        node[part] = '';
                    } else {
                        if (!node[part] || typeof node[part] !== 'object') {
                            node[part] = {};
                        }
                        node = node[part];
                    }
                }
            }
            const renderTree = (node, prefix, output) => {
                let nodeKeys = Object.keys(node);
                nodeKeys.forEach((key, index) => {
                    const last = index === nodeKeys.length - 1;
                    const branch = ctx.outputMode === 'text'
                        ? (last ? '`-- ' : '|-- ')
                        : (last ? '&#9492;&#9472; ' : '&#9500;&#9472; ');
                    output += prefix + branch + key + (ctx.outputMode === 'text' ? '\n' : '<br>');
                    if (typeof node[key] === 'object') {
                        const nextPrefix = ctx.outputMode === 'text'
                            ? prefix + (last ? '    ' : '|   ')
                            : prefix + (last ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '&#9474;&nbsp;&nbsp;&nbsp;');
                        output = renderTree(node[key], nextPrefix, output);
                    }
                });
                return output;
            };
            return { output: renderTree(root, '', ''), status: 0 };
        }
    });

    registerCommand({
        name: 'tar',
        summary: 'Create, list, or extract tar archives.',
        usage: 'tar -cf <archive.tar> <file...> | tar -tf <archive.tar> | tar -xf <archive.tar>',
        execute: async (args, ctx) => {
            const mode = args[1];
            const archiveArg = args[2];
            if (!mode || !archiveArg) return errorResult(ctx, 'Missing archive');
            const archivePath = ctx.resolvePath(archiveArg);
            try {
                if (mode === '-cf') {
                    const fileArgs = args.slice(3);
                    let files = [];
                    if (fileArgs.length === 0 || (fileArgs.length === 1 && (fileArgs[0] === '/' || fileArgs[0] === '.'))) {
                        const entries = await ctx.vfs.ls('/');
                        for (let entry of entries) {
                            if (!entry || entry.endsWith('/')) continue;
                            const content = await ctx.vfs.get(`/${entry}`);
                            files.push({ name: entry, data: content });
                        }
                    } else {
                        for (let i = 0; i < fileArgs.length; i++) {
                            const path = ctx.resolvePath(fileArgs[i]);
                            if (path.endsWith('/')) continue;
                            const content = await ctx.vfs.get(path);
                            const name = path.startsWith('/') ? path.slice(1) : path;
                            files.push({ name, data: content });
                        }
                    }
                    const tar = buildTar(files);
                    await ctx.vfs.put(archivePath, tar);
                    return { output: '', status: 0 };
                }
                if (mode === '-tf') {
                    const raw = await ctx.vfs.get(archivePath);
                    const entries = parseTar(raw).map((entry) => entry.name);
                    return { output: formatOutput(entries, ctx), status: 0 };
                }
                if (mode === '-xf') {
                    const raw = await ctx.vfs.get(archivePath);
                    const entries = parseTar(raw);
                    const decoder = new TextDecoder('utf-8', { fatal: true });
                    for (let entry of entries) {
                        let content = entry.data;
                        try {
                            content = decoder.decode(entry.data);
                        } catch (error) {
                            content = entry.data;
                        }
                        const path = entry.name.startsWith('/') ? entry.name : `/${entry.name}`;
                        await ctx.vfs.put(path, content);
                    }
                    return { output: '', status: 0 };
                }
                return errorResult(ctx, 'Invalid mode');
            } catch (error) {
                return errorResult(ctx, 'Unable to process archive');
            }
        }
    });

    registerCommand({
        name: 'backup',
        summary: 'Create a zip backup of the virtual file system.',
        usage: 'backup <filename>',
        execute: async (args, ctx) => {
            if (!args[1]) return errorResult(ctx, 'Missing filename');
            const JSZipRef = typeof JSZip !== 'undefined' ? JSZip : globalThis.JSZip;
            if (!JSZipRef) return errorResult(ctx, 'JSZip is not available');
            let filename = args[1];
            if (!filename.endsWith('.zip')) filename += '.zip';
            const path = ctx.resolvePath(filename);
            try {
                const entries = await ctx.vfs.ls('/');
                const zip = new JSZipRef();
                for (let entry of entries) {
                    if (!entry || entry.endsWith('/')) continue;
                    const fullPath = entry.startsWith('/') ? entry : `/${entry}`;
                    const content = await ctx.vfs.get(fullPath);
                    zip.file(entry, content);
                }
                const blob = await zip.generateAsync({ type: 'arraybuffer' });
                await ctx.vfs.put(path, blob);
                return { output: 'Backup saved to ' + filename, status: 0 };
            } catch (error) {
                return errorResult(ctx, 'Unable to create backup');
            }
        }
    });

    registerCommand({
        name: 'edit',
        summary: 'Edit a file.',
        usage: 'edit <file>',
        execute: async (args, ctx) => {
            if (!ctx.hooks.edit) return errorResult(ctx, 'No editor available');
            if (!args[1]) return { output: '', status: 0 };
            const path = ctx.resolvePath(args[1]);
            await ctx.hooks.edit(path);
            return { output: '', status: 0 };
        }
    });

    if (Array.isArray(options.commands)) {
        options.commands.forEach(registerCommand);
    }

    return {
        execute,
        listCommands,
        registerCommand,
        resolvePath
    };
}
