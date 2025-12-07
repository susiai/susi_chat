function createShell(vfs, options = {}) {
    const hooks = options.hooks || {};
    const commandList = [];
    const commandMap = new Map();
    let currentPath = '/';
    const history = [];

    function resolvePath(inputPath) {
        if (!inputPath) return '';
        if (inputPath.startsWith('/')) return inputPath;
        return currentPath === '/' ? `/${inputPath}` : `${currentPath}${inputPath}`;
    }

    function ensureDirPath(path) {
        return path.endsWith('/') ? path : `${path}/`;
    }

    async function listChildren(dirPath) {
        const entries = await vfs.ls(dirPath);
        const children = new Set();
        for (let entry of entries) {
            if (!entry) continue;
            if (entry.startsWith('/')) entry = entry.slice(1);
            const firstSegment = entry.split('/')[0];
            if (firstSegment) children.add(firstSegment);
        }
        return Array.from(children);
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

    function registerCommand(command) {
        if (!command || !command.name || !command.execute) return;
        const normalized = {
            summary: '',
            usage: command.name,
            details: '',
            category: 'shell',
            ...command
        };
        commandList.push(normalized);
        commandMap.set(normalized.name, normalized);
    }

    function parseArgs(command) {
        return command.match(/('.*?'|".*?"|[^"\s]+)+/g) || [''];
    }

    function splitPipeline(command) {
        const segments = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < command.length; i++) {
            const char = command[i];
            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (char === '"' && !inSingle) {
                inDouble = !inDouble;
            } else if (char === '|' && !inSingle && !inDouble) {
                segments.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        if (current.trim()) segments.push(current.trim());
        return segments;
    }

    function splitCommands(command) {
        const segments = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < command.length; i++) {
            const char = command[i];
            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (char === '"' && !inSingle) {
                inDouble = !inDouble;
            } else if ((char === ';' || char === '&') && !inSingle && !inDouble) {
                // Treat "&" like ";" so background syntax is accepted but ignored.
                if (current.trim()) segments.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        if (current.trim()) segments.push(current.trim());
        return segments;
    }

    function normalizeMultiline(command) {
        if (!command.includes('\n')) return command;
        const lines = command.split(/\r?\n/);
        const merged = [];
        let buffer = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
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

    function parseRedirections(tokens) {
        const args = [];
        let inputPath = null;
        let outputPath = null;
        let append = false;
        let errPath = null;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if ((token === '>' || token === '>>' || token === '<' || token === '2>') && tokens[i + 1]) {
                const target = stripQuotes(tokens[i + 1]);
                if (token === '<') {
                    inputPath = target;
                } else if (token === '2>') {
                    errPath = target;
                } else {
                    outputPath = target;
                    append = token === '>>';
                }
                i += 1;
                continue;
            }
            args.push(token);
        }
        return { args, inputPath, outputPath, append, errPath };
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
        if (typeof content !== 'string') throw new Error('Not a file');
        return content;
    }

    function splitLines(content) {
        if (content === '') return [];
        return content.split(/\r?\n/);
    }

    function renderLines(content) {
        if (!content) return '';
        return splitLines(content).join('<br>');
    }

    function renderLinesWithMode(content, ctx) {
        if (!content) return '';
        if (ctx && ctx.outputMode === 'text') return content;
        return renderLines(content);
    }

    function joinLines(lines, ctx) {
        if (ctx && ctx.outputMode === 'text') return lines.join('\n');
        return lines.join('<br>');
    }

    function decodeEscapes(value) {
        if (!value) return '';
        return value
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r');
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

    async function writeConfig(config) {
        const path = '/config.json';
        await vfs.put(path, JSON.stringify(config, null, 2));
    }

    function expandArg(token, envMap) {
        if (!token) return token;
        const isSingleQuoted = token.startsWith("'") && token.endsWith("'");
        const isDoubleQuoted = token.startsWith('"') && token.endsWith('"');
        let value = token;
        if (isSingleQuoted) {
            return stripQuotes(value);
        }
        if (isDoubleQuoted) {
            value = stripQuotes(value);
        }
        value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(envMap, name)) return '';
            return envMap[name];
        });
        return value;
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

    async function execute(command) {
        if (!command) return { handled: false, output: '' };
        command = normalizeMultiline(command);
        const historyExpansion = resolveHistory(command.trim());
        if (historyExpansion === '') {
            return { handled: true, output: 'Error: History entry not found' };
        }
        if (historyExpansion) command = historyExpansion;
        recordHistory(command.trim());
        const chained = splitCommands(command);
        if (chained.length > 1) {
            let combinedOutput = '';
            for (let i = 0; i < chained.length; i++) {
                const result = await execute(chained[i]);
                if (!result.handled) return result;
                if (result.output) {
                    combinedOutput = combinedOutput
                        ? combinedOutput + '<br>' + result.output
                        : result.output;
                }
            }
            return { handled: true, output: combinedOutput };
        }
        const config = await readConfig();
        const envMap = {};
        Object.keys(config || {}).forEach((key) => {
            const value = config[key];
            envMap[key] = typeof value === 'string' ? value : JSON.stringify(value);
        });
        const segments = splitPipeline(command);
        if (segments.length > 1) {
            let input = '';
            for (let i = 0; i < segments.length; i++) {
                const tokens = parseArgs(segments[i]).map((token) => expandArg(token, envMap));
                const redir = parseRedirections(tokens);
                const args = redir.args;
                const commandName = args[0];
                if (!commandMap.has(commandName)) return { handled: false, output: '' };
                const handler = commandMap.get(commandName);
                if (redir.inputPath && i > 0) return { handled: true, output: 'Error: Input redirection must be on the first command' };
                if ((redir.outputPath || redir.errPath) && i < segments.length - 1) {
                    return { handled: true, output: 'Error: Output redirection must be on the last command' };
                }
                if (redir.inputPath && input) {
                    return { handled: true, output: 'Error: Input already provided' };
                }
                if (redir.inputPath) {
                    try {
                        const content = await vfs.get(resolvePath(redir.inputPath));
                        input = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    } catch (error) {
                        return { handled: true, output: 'Error: Unable to read input file' };
                    }
                }
                const ctx = {
                    ...getContext(),
                    outputMode: redir.outputPath || redir.errPath || i < segments.length - 1 ? 'text' : 'html',
                    hasInput: i > 0
                };
                const output = await handler.execute(args, ctx, input);
                const outputText = typeof output === 'string' ? output : '';
                const isError = outputText.startsWith('Error:');
                if (redir.errPath && isError) {
                    const errPath = resolvePath(redir.errPath);
                    if (redir.append) {
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
                    input = '';
                } else if (redir.outputPath && !isError) {
                    const outPath = resolvePath(redir.outputPath);
                    if (redir.append) {
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
                    input = '';
                } else {
                    input = outputText;
                }
                if (typeof input !== 'string') input = '';
            }
            return { handled: true, output: input || '' };
        }
        const tokens = parseArgs(command).map((token) => expandArg(token, envMap));
        const redir = parseRedirections(tokens);
        const args = redir.args;
        const commandName = args[0];
        if (!commandMap.has(commandName)) return { handled: false, output: '' };
        if (redir.inputPath && redir.outputPath && redir.inputPath === redir.outputPath) {
            return { handled: true, output: 'Error: Input and output file are the same' };
        }
        const handler = commandMap.get(commandName);
        let input = '';
        if (redir.inputPath) {
            try {
                const content = await vfs.get(resolvePath(redir.inputPath));
                input = typeof content === 'string' ? content : new TextDecoder().decode(content);
            } catch (error) {
                return { handled: true, output: 'Error: Unable to read input file' };
            }
        }
        const ctx = {
            ...getContext(),
            outputMode: redir.outputPath || redir.errPath ? 'text' : 'html',
            hasInput: Boolean(redir.inputPath)
        };
        const output = await handler.execute(args, ctx, input);
        const outputText = typeof output === 'string' ? output : '';
        const isError = outputText.startsWith('Error:');
        if (redir.errPath && isError) {
            const errPath = resolvePath(redir.errPath);
            if (redir.append) {
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
            return { handled: true, output: '' };
        }
        if (redir.outputPath && !isError) {
            const outPath = resolvePath(redir.outputPath);
            if (redir.append) {
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
            return { handled: true, output: '' };
        }
        return { handled: true, output: outputText || '' };
    }

    function listCommands() {
        return commandList.slice();
    }

    async function collectTreePaths(basePath) {
        const entries = await vfs.ls(basePath);
        const files = [];
        const dirs = new Set();
        entries.forEach((entry) => {
            if (!entry) return;
            const full = basePath === '/' ? `/${entry}` : `${basePath}${entry}`;
            if (entry.endsWith('/')) {
                dirs.add(full);
                return;
            }
            files.push(full);
            const parts = full.split('/').filter(Boolean);
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
            if (!args[1]) return '';
            const path = ctx.resolvePath(args[1]);
            ctx.vfs.touch(path);
            return '';
        }
    });

    registerCommand({
        name: 'env',
        summary: 'Display environment variables.',
        usage: 'env',
        execute: async (args, ctx) => {
            const config = await readConfig();
            const lines = Object.keys(config || {}).map((key) => `${key}=${config[key]}`);
            return joinLines(lines, ctx);
        }
    });

    registerCommand({
        name: 'printenv',
        summary: 'Print environment variables.',
        usage: 'printenv [name]',
        execute: async (args, ctx) => {
            const config = await readConfig();
            if (!args[1]) {
                const lines = Object.keys(config || {}).map((key) => `${key}=${config[key]}`);
                return joinLines(lines, ctx);
            }
            const key = args[1];
            if (!Object.prototype.hasOwnProperty.call(config, key)) return '';
            return String(config[key]);
        }
    });

    registerCommand({
        name: 'export',
        summary: 'Set environment variables.',
        usage: 'export NAME=value | export NAME value',
        execute: async (args) => {
            if (!args[1]) return 'Error: Missing name';
            const config = await readConfig();
            let name = args[1];
            let value = args.slice(2).join(' ');
            if (name.includes('=')) {
                const parts = name.split('=');
                name = parts[0];
                value = parts.slice(1).join('=') || '';
            }
            config[name] = value;
            await writeConfig(config);
            return '';
        }
    });

    registerCommand({
        name: 'unset',
        summary: 'Unset environment variables.',
        usage: 'unset NAME',
        execute: async (args) => {
            if (!args[1]) return 'Error: Missing name';
            const config = await readConfig();
            delete config[args[1]];
            await writeConfig(config);
            return '';
        }
    });

    registerCommand({
        name: 'mv',
        summary: 'Rename or move a file.',
        usage: 'mv <oldname> <newname>',
        execute: (args, ctx) => {
            if (!args[1] || !args[2]) return '';
            const srcPath = ctx.resolvePath(args[1]);
            const destPath = ctx.resolvePath(args[2]);
            ctx.vfs.mv(srcPath, destPath);
            return '';
        }
    });

    registerCommand({
        name: 'cp',
        summary: 'Copy files and directories.',
        usage: 'cp [-r] <source> <dest>',
        execute: async (args, ctx) => {
            let recursive = false;
            let srcArg = null;
            let destArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-r' || args[i] === '-R') {
                    recursive = true;
                } else if (!srcArg) {
                    srcArg = args[i];
                } else if (!destArg) {
                    destArg = args[i];
                }
            }
            if (!srcArg || !destArg) return '';
            const srcPath = ctx.resolvePath(srcArg);
            const destPath = ctx.resolvePath(destArg);
            if (srcPath.endsWith('/') || destPath.endsWith('/')) {
                if (!recursive) return 'Error: Use -r for directories';
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
                    return '';
                } catch (error) {
                    return 'Error: Invalid directory';
                }
            }
            try {
                const content = await ctx.vfs.get(srcPath);
                if (typeof content !== 'string') return 'Error: ' + srcArg + ' is not a file';
                ctx.vfs.put(destPath, content);
                return '';
            } catch (error) {
                return 'Error: ' + srcArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'rm',
        summary: 'Remove files or directories.',
        usage: 'rm [-r] <path>',
        execute: async (args, ctx) => {
            let recursive = false;
            let targetArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-r' || args[i] === '-R') {
                    recursive = true;
                } else if (!targetArg) {
                    targetArg = args[i];
                }
            }
            if (!targetArg) return '';
            const targetPath = ctx.resolvePath(targetArg);
            if (!targetPath.endsWith('/')) {
                ctx.vfs.rm(targetPath);
                return '';
            }
            if (!recursive) return 'Error: Use -r for directories';
            const base = ctx.ensureDirPath(targetPath);
            try {
                const { files, dirs } = await collectTreePaths('/');
                for (let file of files) {
                    if (file.startsWith(base)) ctx.vfs.rm(file);
                }
                const dirsToRemove = dirs.filter((dir) => dir.startsWith(base)).sort((a, b) => b.length - a.length);
                dirsToRemove.forEach((dir) => ctx.vfs.rm(dir));
                ctx.vfs.rm(base);
                return '';
            } catch (error) {
                return 'Error: Invalid directory';
            }
        }
    });

    registerCommand({
        name: 'less',
        summary: 'Display the contents of a file.',
        usage: 'less <file>',
        execute: async (args, ctx) => {
            if (!args[1]) return 'Error: No file given';
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) return 'Error: ' + args[1] + ' is not a file';
            try {
                const content = await ctx.vfs.get(path);
                return typeof content === 'string' ? renderLinesWithMode(content, ctx) : '';
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'cat',
        summary: 'Concatenate and print files.',
        usage: 'cat <file>',
        execute: async (args, ctx, input) => {
            if (!args[1] && ctx.hasInput) return renderLinesWithMode(input, ctx);
            if (!args[1]) return 'Error: No file given';
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) return 'Error: ' + args[1] + ' is not a file';
            try {
                const content = await ctx.vfs.get(path);
                return typeof content === 'string' ? renderLinesWithMode(content, ctx) : '';
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'more',
        summary: 'Display the contents of a file.',
        usage: 'more <file>',
        execute: async (args, ctx) => {
            if (!args[1]) return 'Error: No file given';
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) return 'Error: ' + args[1] + ' is not a file';
            try {
                const content = await ctx.vfs.get(path);
                return typeof content === 'string' ? renderLinesWithMode(content, ctx) : '';
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'head',
        summary: 'Output the first part of files.',
        usage: 'head [-n N] [-c N] <file>',
        execute: async (args, ctx, input) => {
            let count = 10;
            let byteCount = null;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-n' && args[i + 1]) {
                    count = Number(args[i + 1]);
                    i += 1;
                    continue;
                }
                if (args[i] === '-c' && args[i + 1]) {
                    byteCount = Number(args[i + 1]);
                    i += 1;
                    continue;
                }
                if (!fileArg) fileArg = args[i];
            }
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                if (byteCount !== null) {
                    const normalizedBytes = Number.isFinite(byteCount) && byteCount >= 0 ? Math.floor(byteCount) : 0;
                    return renderLinesWithMode(content.slice(0, normalizedBytes), ctx);
                }
                const normalizedCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 10;
                const lines = splitLines(content);
                return joinLines(lines.slice(0, normalizedCount), ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'tail',
        summary: 'Output the last part of files.',
        usage: 'tail [-n N] [-c N] <file>',
        execute: async (args, ctx, input) => {
            let count = 10;
            let byteCount = null;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-n' && args[i + 1]) {
                    count = Number(args[i + 1]);
                    i += 1;
                    continue;
                }
                if (args[i] === '-c' && args[i + 1]) {
                    byteCount = Number(args[i + 1]);
                    i += 1;
                    continue;
                }
                if (!fileArg) fileArg = args[i];
            }
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
            try {
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                if (byteCount !== null) {
                    const normalizedBytes = Number.isFinite(byteCount) && byteCount >= 0 ? Math.floor(byteCount) : 0;
                    if (normalizedBytes === 0) return '';
                    return renderLinesWithMode(content.slice(-normalizedBytes), ctx);
                }
                const normalizedCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 10;
                const lines = splitLines(content);
                if (normalizedCount === 0) return '';
                return joinLines(lines.slice(-normalizedCount), ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'wc',
        summary: 'Print newline, word, and byte counts.',
        usage: 'wc [-l] [-w] [-c] <file>',
        execute: async (args, ctx, input) => {
            let showLines = false;
            let showWords = false;
            let showBytes = false;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i].startsWith('-')) {
                    showLines = showLines || args[i].includes('l');
                    showWords = showWords || args[i].includes('w');
                    showBytes = showBytes || args[i].includes('c');
                } else if (!fileArg) {
                    fileArg = args[i];
                }
            }
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
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
                return parts.join(' ');
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'grep',
        summary: 'Search for a pattern in a file.',
        usage: 'grep [-i] [-n] [-v] <pattern> <file>',
        execute: async (args, ctx, input) => {
            let flags = '';
            let showLineNumbers = false;
            let invertMatch = false;
            const rest = [];
            for (let i = 1; i < args.length; i++) {
                if (args[i].startsWith('-')) {
                    if (args[i].includes('i')) flags += 'i';
                    if (args[i].includes('n')) showLineNumbers = true;
                    if (args[i].includes('v')) invertMatch = true;
                } else {
                    rest.push(args[i]);
                }
            }
            if (rest.length < 1) return 'Error: Missing pattern';
            const pattern = stripQuotes(rest[0]);
            const fileArg = rest[1];
            let regex;
            try {
                regex = new RegExp(pattern, flags);
            } catch (error) {
                return 'Error: Invalid pattern';
            }
            try {
                if (!fileArg && !ctx.hasInput) return 'Error: Missing file';
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                const lines = splitLines(content);
                const matches = [];
                lines.forEach((line, index) => {
                    const isMatch = regex.test(line);
                    if (invertMatch ? !isMatch : isMatch) {
                        matches.push(showLineNumbers ? `${index + 1}:${line}` : line);
                    }
                });
                return joinLines(matches, ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'find',
        summary: 'Search for files by pattern.',
        usage: 'find [path] <pattern>',
        execute: async (args, ctx) => {
            if (!args[1]) return 'Error: Missing pattern';
            let baseArg = null;
            let patternArg = null;
            if (args[2]) {
                baseArg = args[1];
                patternArg = args[2];
            } else {
                patternArg = args[1];
            }
            const basePath = baseArg ? ctx.ensureDirPath(ctx.resolvePath(baseArg)) : ctx.getCurrentPath();
            let regex;
            try {
                regex = new RegExp(stripQuotes(patternArg));
            } catch (error) {
                return 'Error: Invalid pattern';
            }
            try {
                const entries = await ctx.vfs.ls(basePath);
                const matches = entries
                    .filter((entry) => regex.test(entry))
                    .map((entry) => (basePath === '/' ? `/${entry}` : `${basePath}${entry}`));
                return joinLines(matches, ctx);
            } catch (error) {
                return 'Error: Invalid directory';
            }
        }
    });

    registerCommand({
        name: 'sort',
        summary: 'Sort lines of text.',
        usage: 'sort [-r] [-n] [-k N] <file>',
        execute: async (args, ctx, input) => {
            let descending = false;
            let numeric = false;
            let keyIndex = null;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-r') {
                    descending = true;
                } else if (args[i] === '-n') {
                    numeric = true;
                } else if (args[i] === '-k' && args[i + 1]) {
                    keyIndex = Number(args[i + 1]);
                    i += 1;
                } else if (!fileArg) {
                    fileArg = args[i];
                }
            }
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
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
                return joinLines(lines, ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'cut',
        summary: 'Remove sections from each line.',
        usage: 'cut -d <delimiter> -f <list> [file] | cut -b <list> [file]',
        execute: async (args, ctx, input) => {
            let delimiter = '\t';
            let fields = null;
            let bytes = null;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-d' && args[i + 1]) {
                    delimiter = decodeEscapes(stripQuotes(args[i + 1]));
                    i += 1;
                    continue;
                }
                if (args[i] === '-f' && args[i + 1]) {
                    fields = args[i + 1];
                    i += 1;
                    continue;
                }
                if (args[i] === '-b' && args[i + 1]) {
                    bytes = args[i + 1];
                    i += 1;
                    continue;
                }
                if (!fileArg) fileArg = args[i];
            }
            if (fields && bytes) return 'Error: Invalid options';
            if (!fields && !bytes) return 'Error: Missing field list';
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
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
                return joinLines(output, ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'paste',
        summary: 'Merge lines of files.',
        usage: 'paste [file...]',
        execute: async (args, ctx, input) => {
            const fileArgs = args.slice(1);
            if (fileArgs.length === 0 && !ctx.hasInput) return 'Error: No file given';
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
                    return 'Error: ' + fileArgs[i] + ' is not a file';
                }
            }
            if (streams.length === 0) return '';
            const maxLines = Math.max(...streams.map((stream) => stream.length));
            const output = [];
            for (let i = 0; i < maxLines; i++) {
                const row = streams.map((stream) => (stream[i] !== undefined ? stream[i] : '')).join('\t');
                output.push(row);
            }
            return joinLines(output, ctx);
        }
    });

    registerCommand({
        name: 'tr',
        summary: 'Translate or delete characters.',
        usage: 'tr [-d] <set1> [set2]',
        execute: async (args, ctx, input) => {
            if (!ctx.hasInput) return 'Error: No input';
            let deleteMode = false;
            let set1 = null;
            let set2 = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-d') {
                    deleteMode = true;
                    continue;
                }
                if (!set1) {
                    set1 = args[i];
                } else if (!set2) {
                    set2 = args[i];
                }
            }
            if (!set1) return 'Error: Missing set';
            const sourceSet = expandCharSet(decodeEscapes(stripQuotes(set1)));
            const targetSet = deleteMode ? '' : expandCharSet(decodeEscapes(stripQuotes(set2 || '')));
            if (deleteMode) {
                const remove = new Set(sourceSet.split(''));
                const output = input.split('').filter((char) => !remove.has(char)).join('');
                return renderLinesWithMode(output, ctx);
            }
            const map = new Map();
            for (let i = 0; i < sourceSet.length; i++) {
                map.set(sourceSet[i], targetSet[i] !== undefined ? targetSet[i] : targetSet[targetSet.length - 1] || '');
            }
            const output = input.split('').map((char) => (map.has(char) ? map.get(char) : char)).join('');
            return renderLinesWithMode(output, ctx);
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
                            return 'Error: Unable to read data file';
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
            if (!url) return 'Error: Missing URL';
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: data
                });
                if (!response.ok) {
                    return `Error: HTTP ${response.status}`;
                }
                if (outputFile) {
                    const buffer = await response.arrayBuffer();
                    await ctx.vfs.put(ctx.resolvePath(outputFile), buffer);
                    return '';
                }
                const text = await response.text();
                return renderLinesWithMode(text, ctx);
            } catch (error) {
                return 'Error: Request failed';
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
            if (!url) return 'Error: Missing URL';
            const fallbackName = url.split('/').filter(Boolean).pop() || 'index.html';
            const target = outputFile || fallbackName;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    return `Error: HTTP ${response.status}`;
                }
                const buffer = await response.arrayBuffer();
                await ctx.vfs.put(ctx.resolvePath(target), buffer);
                return '';
            } catch (error) {
                return 'Error: Request failed';
            }
        }
    });

    registerCommand({
        name: 'uniq',
        summary: 'Report or filter repeated lines.',
        usage: 'uniq [-c] [-d] [-u] <file>',
        execute: async (args, ctx, input) => {
            let showCounts = false;
            let onlyDuplicates = false;
            let onlyUniques = false;
            let fileArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-c') {
                    showCounts = true;
                } else if (args[i] === '-d') {
                    onlyDuplicates = true;
                } else if (args[i] === '-u') {
                    onlyUniques = true;
                } else if (!fileArg) {
                    fileArg = args[i];
                }
            }
            if (onlyDuplicates && onlyUniques) return 'Error: Invalid flags';
            if (!fileArg && !ctx.hasInput) return 'Error: No file given';
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
                return joinLines(output, ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'sed',
        summary: 'Stream editor for basic substitutions.',
        usage: 'sed <script> <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) return 'Error: Missing script';
            const script = stripQuotes(args[1]);
            const fileArg = args[2];
            if (!script.startsWith('s')) return 'Error: Only substitution scripts are supported';
            const delimiter = script[1];
            if (!delimiter) return 'Error: Invalid script';
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
            if (!patternSegment) return 'Error: Invalid script';
            const replacementSegment = parseSegment(patternSegment.nextIndex);
            if (!replacementSegment) return 'Error: Invalid script';
            const flags = script.slice(replacementSegment.nextIndex);
            let regex;
            try {
                const regexFlags = `${flags.includes('g') ? 'g' : ''}${flags.includes('i') ? 'i' : ''}`;
                regex = new RegExp(patternSegment.value, regexFlags);
            } catch (error) {
                return 'Error: Invalid pattern';
            }
            try {
                if (!fileArg && !ctx.hasInput) return 'Error: Missing file';
                const content = fileArg ? await readFileContent(ctx.resolvePath(fileArg), ctx) : input;
                return renderLinesWithMode(content.replace(regex, replacementSegment.value), ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'awk',
        summary: 'Pattern scanning and processing.',
        usage: 'awk <script> <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) return 'Error: Missing script';
            const script = stripQuotes(args[1]);
            const fileArg = args[2];
            const printMatch = script.match(/print\s+(.+)/);
            if (!printMatch) return 'Error: Only print scripts are supported';
            let fieldsPart = printMatch[1].trim();
            fieldsPart = fieldsPart.replace(/^\{|\}$/g, '').trim();
            const fields = fieldsPart.split(/\s*,\s*/).filter(Boolean);
            try {
                if (!fileArg && !ctx.hasInput) return 'Error: Missing file';
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
                return joinLines(output, ctx);
            } catch (error) {
                return 'Error: ' + fileArg + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'tee',
        summary: 'Read from stdin and write to stdout and files.',
        usage: 'tee <file>',
        execute: async (args, ctx, input) => {
            if (!args[1]) return 'Error: Missing file';
            if (!ctx.hasInput) return 'Error: No input';
            const path = ctx.resolvePath(args[1]);
            try {
                await ctx.vfs.put(path, input);
            } catch (error) {
                return 'Error: Unable to write file';
            }
            return renderLinesWithMode(input, ctx);
        }
    });

    registerCommand({
        name: 'xargs',
        summary: 'Build and execute command lines from input.',
        usage: 'xargs <command> [args...]',
        execute: async (args, ctx, input) => {
            if (!ctx.hasInput) return 'Error: No input';
            const commandName = args[1] || 'echo';
            if (!commandMap.has(commandName)) return 'Error: Invalid command';
            const baseArgs = args.slice(2);
            const handler = commandMap.get(commandName);
            const lines = splitLines(input).filter((line) => line !== '');
            const outputs = [];
            for (let i = 0; i < lines.length; i++) {
                const lineArg = lines[i];
                const lineArgs = [commandName].concat(baseArgs, lineArg);
                const output = await handler.execute(lineArgs, { ...ctx, outputMode: 'text', hasInput: true }, lineArg);
                if (typeof output === 'string' && output !== '') outputs.push(output);
            }
            return renderLinesWithMode(outputs.join('\n'), ctx);
        }
    });

    registerCommand({
        name: 'diff',
        summary: 'Compare files line by line.',
        usage: 'diff <file1> <file2>',
        execute: async (args, ctx) => {
            if (!args[1] || !args[2]) return 'Error: Missing file';
            const leftArg = args[1];
            const rightArg = args[2];
            const leftPath = ctx.resolvePath(leftArg);
            const rightPath = ctx.resolvePath(rightArg);
            try {
                const leftContent = await readFileContent(leftPath, ctx);
                const rightContent = await readFileContent(rightPath, ctx);
                if (leftContent === rightContent) return '';
                const leftLines = splitLines(leftContent);
                const rightLines = splitLines(rightContent);
                const maxLines = Math.max(leftLines.length, rightLines.length);
                const output = [];
                for (let i = 0; i < maxLines; i++) {
                    const leftLine = leftLines[i];
                    const rightLine = rightLines[i];
                    if (leftLine === rightLine) {
                        if (leftLine !== undefined) output.push(`  ${leftLine}`);
                        continue;
                    }
                    if (leftLine !== undefined) output.push(`- ${leftLine}`);
                    if (rightLine !== undefined) output.push(`+ ${rightLine}`);
                }
                return ctx.outputMode === 'text' ? output.join('\n') : `<pre>${output.join('\n')}</pre>`;
            } catch (error) {
                return 'Error: One or both files are invalid';
            }
        }
    });

    registerCommand({
        name: 'echo',
        summary: 'Display a line of text.',
        usage: 'echo [text]',
        execute: (args) => args.slice(1).join(' ')
    });

    registerCommand({
        name: 'printf',
        summary: 'Format and print data.',
        usage: 'printf <format> [args...]',
        execute: (args, ctx, input) => {
            let format = args[1] || '';
            if (!format && ctx.hasInput) {
                return renderLinesWithMode(input, ctx);
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
            return renderLinesWithMode(output, ctx);
        }
    });

    registerCommand({
        name: 'history',
        summary: 'Display command history.',
        usage: 'history',
        execute: (args, ctx) => {
            const lines = history.map((entry, index) => `${index + 1}  ${entry}`);
            return joinLines(lines, ctx);
        }
    });

    registerCommand({
        name: 'date',
        summary: 'Display the current date and time.',
        usage: 'date',
        execute: () => new Date().toString()
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
                    return `${renderRow(headers)}\n${renderRow(values)}`;
                }
                const renderCells = (cells, cellTag) =>
                    cells.map((cell) => `<${cellTag} style="padding-right: 12px; text-align: left;">${cell}</${cellTag}>`).join('');
                return `<table style="border-collapse: collapse; font-family: monospace;"><tr>${renderCells(headers, 'th')}</tr><tr>${renderCells(values, 'td')}</tr></table>`;
            } catch (error) {
                return 'Error: Storage estimate not available';
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
            if (!delay) return '';
            await new Promise((resolve) => setTimeout(resolve, delay));
            return '';
        }
    });

    registerCommand({
        name: 'ls',
        summary: 'List directory contents.',
        usage: 'ls',
        execute: async (args, ctx) => {
            try {
                const children = await ctx.listChildren(ctx.getCurrentPath());
                return joinLines(children, ctx);
            } catch (error) {
                return 'Error: Invalid directory';
            }
        }
    });

    registerCommand({
        name: 'pwd',
        summary: 'Print the name of the current working directory.',
        usage: 'pwd',
        execute: (args, ctx) => ctx.getCurrentPath()
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
                return '';
            }
            return 'Error: Invalid directory';
        }
    });

    registerCommand({
        name: 'mkdir',
        summary: 'Create a directory.',
        usage: 'mkdir <dir>',
        execute: async (args, ctx) => {
            if (!args[1]) return '';
            let recursive = false;
            let targetArg = null;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '-p') {
                    recursive = true;
                } else if (!targetArg) {
                    targetArg = args[i];
                }
            }
            if (!targetArg) return '';
            const dirPath = ctx.ensureDirPath(ctx.resolvePath(targetArg));
            if (!recursive) {
                ctx.vfs.put(dirPath, '');
                return '';
            }
            const parts = dirPath.split('/').filter(Boolean);
            let current = '/';
            for (let i = 0; i < parts.length; i++) {
                current += parts[i] + '/';
                await ctx.vfs.put(current, '');
            }
            return '';
        }
    });

    registerCommand({
        name: 'ln',
        summary: 'Create a link to a file.',
        usage: 'ln <target> <linkname>',
        execute: async (args, ctx) => {
            if (!args[1] || !args[2]) return '';
            const targetPath = ctx.resolvePath(args[1]);
            const linkPath = ctx.resolvePath(args[2]);
            if (targetPath.endsWith('/') || linkPath.endsWith('/')) return 'Error: Links to files only';
            try {
                const content = await ctx.vfs.get(targetPath);
                if (typeof content !== 'string') return 'Error: ' + args[1] + ' is not a file';
                await ctx.vfs.put(linkPath, content);
                return '';
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'stat',
        summary: 'Display file status.',
        usage: 'stat <file>',
        execute: async (args, ctx) => {
            if (!args[1]) return 'Error: Missing file';
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) return 'Error: Invalid file';
            try {
                const content = await ctx.vfs.get(path);
                const size = typeof content === 'string' ? content.length : content.byteLength || 0;
                return `File: ${args[1]}<br>Size: ${size} bytes<br>Type: file`;
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'test',
        summary: 'Check file conditions.',
        usage: 'test -e <path> | test -f <file> | test -d <dir>',
        execute: async (args, ctx) => {
            if (!args[1] || !args[2]) return 'Error: Missing operand';
            const flag = args[1];
            const target = ctx.resolvePath(args[2]);
            try {
                if (flag === '-e') {
                    await ctx.vfs.get(target);
                    return '';
                }
                if (flag === '-f') {
                    if (target.endsWith('/')) return 'Error: Not a file';
                    await ctx.vfs.get(target);
                    return '';
                }
                if (flag === '-d') {
                    const dirPath = ctx.ensureDirPath(target);
                    if (await ctx.dirExists(dirPath)) return '';
                    return 'Error: Not a directory';
                }
                return 'Error: Invalid flag';
            } catch (error) {
                return 'Error: Not found';
            }
        }
    });

    registerCommand({
        name: '[',
        summary: 'Check file conditions.',
        usage: '[ -e <path> ] | [ -f <file> ] | [ -d <dir> ]',
        execute: async (args, ctx) => {
            const closing = args[args.length - 1];
            if (closing !== ']') return 'Error: Missing ]';
            const inner = args.slice(0, -1);
            return await commandMap.get('test').execute(inner, ctx);
        }
    });

    registerCommand({
        name: 'rmdir',
        summary: 'Remove a directory.',
        usage: 'rmdir <dir>',
        execute: async (args, ctx) => {
            if (!args[1]) return '';
            const dirPath = ctx.ensureDirPath(ctx.resolvePath(args[1]));
            const children = await ctx.listChildren(dirPath);
            if (children.length === 0) {
                ctx.vfs.rm(dirPath);
            }
            return '';
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
            return renderTree(root, '', '');
        }
    });

    registerCommand({
        name: 'tar',
        summary: 'Create, list, or extract tar archives.',
        usage: 'tar -cf <archive.tar> <file...> | tar -tf <archive.tar> | tar -xf <archive.tar>',
        execute: async (args, ctx) => {
            const mode = args[1];
            const archiveArg = args[2];
            if (!mode || !archiveArg) return 'Error: Missing archive';
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
                    return '';
                }
                if (mode === '-tf') {
                    const raw = await ctx.vfs.get(archivePath);
                    const entries = parseTar(raw).map((entry) => entry.name);
                    return joinLines(entries, ctx);
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
                    return '';
                }
                return 'Error: Invalid mode';
            } catch (error) {
                return 'Error: Unable to process archive';
            }
        }
    });

    registerCommand({
        name: 'backup',
        summary: 'Create a zip backup of the virtual file system.',
        usage: 'backup <filename>',
        execute: async (args, ctx) => {
            if (!args[1]) return 'Error: Missing filename';
            const JSZipRef = typeof JSZip !== 'undefined' ? JSZip : globalThis.JSZip;
            if (!JSZipRef) return 'Error: JSZip is not available';
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
                return 'Backup saved to ' + filename;
            } catch (error) {
                return 'Error: Unable to create backup';
            }
        }
    });

    registerCommand({
        name: 'edit',
        summary: 'Edit a file.',
        usage: 'edit <file>',
        execute: async (args, ctx) => {
            if (!ctx.hooks.edit) return 'Error: No editor available';
            if (!args[1]) return '';
            const path = ctx.resolvePath(args[1]);
            await ctx.hooks.edit(path);
            return '';
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
