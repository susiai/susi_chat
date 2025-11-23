function createShell(vfs, options = {}) {
    const hooks = options.hooks || {};
    const commandList = [];
    const commandMap = new Map();
    let currentPath = '/';

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

    async function execute(command) {
        const args = parseArgs(command);
        const commandName = args[0];
        if (!commandMap.has(commandName)) return { handled: false, output: '' };
        const handler = commandMap.get(commandName);
        const output = await handler.execute(args, getContext());
        return { handled: true, output: output || '' };
    }

    function listCommands() {
        return commandList.slice();
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
        name: 'rm',
        summary: 'Remove a file.',
        usage: 'rm <file>',
        execute: (args, ctx) => {
            if (!args[1]) return '';
            const path = ctx.resolvePath(args[1]);
            if (path.endsWith('/')) return '';
            ctx.vfs.rm(path);
            return '';
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
                return typeof content === 'string' ? content : '';
            } catch (error) {
                return 'Error: ' + args[1] + ' is not a file';
            }
        }
    });

    registerCommand({
        name: 'ls',
        summary: 'List directory contents.',
        usage: 'ls',
        execute: async (args, ctx) => {
            try {
                const children = await ctx.listChildren(ctx.getCurrentPath());
                return children.join('<br>');
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
        execute: (args, ctx) => {
            if (!args[1]) return '';
            const dirPath = ctx.ensureDirPath(ctx.resolvePath(args[1]));
            ctx.vfs.put(dirPath, '');
            return '';
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
                    output += prefix + (last ? '&#9492;&#9472; ' : '&#9500;&#9472; ') + key + '<br>';
                    if (typeof node[key] === 'object') {
                        output = renderTree(node[key], prefix + (last ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '&#9474;&nbsp;&nbsp;&nbsp;'), output);
                    }
                });
                return output;
            };
            return renderTree(root, '', '');
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
