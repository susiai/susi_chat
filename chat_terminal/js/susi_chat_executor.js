function createChatExecutor(deps) {
    const {
        log,
        chatHistory,
        configStore,
        shell,
        vfs,
        llm,
        getApihost,
        setApihost,
        getModel,
        setModel,
        getApikey,
        setApikey,
        getCompanion,
        setCompanion,
        getSystemPrompt,
        setSystemPrompt,
        getMaxTokens,
        setMaxTokens,
        getSelectedFile,
        promptPrefix,
        terminal,
        getPerformance,
        defaultConfig,
        bulletpoints,
        ALLOWED_MIME_TYPES
    } = deps;

    const commandList = [];
    const commandMap = new Map();

    function registerCommand(command) {
        if (!command || !command.name || !command.execute) return;
        const normalized = {
            summary: '',
            usage: command.name,
            details: '',
            category: 'chat',
            ...command
        };
        commandList.push(normalized);
        commandMap.set(normalized.name, normalized);
    }

    function parseArgs(command) {
        return command.match(/('.*?'|".*?"|[^"\s]+)+/g) || [''];
    }

    function listCommands() {
        return commandList.slice();
    }

    function formatHelp(entry) {
        if (!entry) return 'Error: Invalid command';
        let lines = [];
        if (entry.usage) {
            lines.push(entry.usage);
            lines.push('');
        }
        if (entry.summary) lines.push(entry.summary);
        if (entry.details) {
            lines.push('');
            lines.push(entry.details);
        }
        return lines.join('\n');
    }

    function renderHelp(commandName) {
        const shellCommands = shell.listCommands ? shell.listCommands() : [];
        const allCommands = shellCommands.concat(listCommands());
        if (!commandName) {
            const names = allCommands.map((cmd) => cmd.name).sort();
            return (
                'This is a terminal for the <a href="https://github.com/susiai/susi_chat" target="_blank">SUSI.AI Chat v2.</a>\n\n' +
                'It is a simple terminal emulator with a virtual file system.\n\n' +
                'You can either chat with the AI assistant or use the following commands:\n\n' +
                names.join(', ') +
                '\n\nType "help <command>" to get more information about a specific command'
            );
        }
        const entry = allCommands.find((cmd) => cmd.name === commandName);
        return formatHelp(entry);
    }

    registerCommand({
        name: 'help',
        summary: 'Display information about builtin commands.',
        usage: 'help [command]',
        execute: (args) => {
            log(renderHelp(args[1] ? args[1].toLowerCase() : ''));
        }
    });

    registerCommand({
        name: 'reset',
        summary: 'Reset the terminal messages.',
        usage: 'reset',
        execute: () => {
            chatHistory.reset(getSystemPrompt());
        }
    });

    registerCommand({
        name: 'host',
        summary: 'Get or set the API host.',
        usage: 'host [url]',
        execute: (args) => {
            if (args[1]) {
                const apihost = args[1];
                setApihost(apihost);
                configStore.set('apihost', apihost);
                log('set host api to ' + apihost);
            } else {
                log('Host API : ' + getApihost());
            }
        }
    });

    registerCommand({
        name: 'model',
        summary: 'Get or set the model.',
        usage: 'model [name]',
        execute: (args) => {
            if (args[1]) {
                const model = args[1];
                setModel(model);
                configStore.set('model', model);
                log('set model to ' + model);
            } else {
                log('model : ' + getModel());
            }
        }
    });

    registerCommand({
        name: 'apikey',
        summary: 'Set the API key.',
        usage: 'apikey <key>',
        execute: (args) => {
            if (args[1]) {
                const apikey = args[1];
                setApikey(apikey);
                configStore.set('apikey', apikey);
                log('set apikey');
            } else {
                log('you can only set the api key, not view one, give a as argument');
            }
        }
    });

    registerCommand({
        name: 'max_tokens',
        summary: 'Get or set the max token limit.',
        usage: 'max_tokens [number]',
        execute: (args) => {
            if (args[1]) {
                const maxTokens = Number(args[1]);
                setMaxTokens(maxTokens);
                log('set max_tokens to ' + maxTokens);
            } else {
                log('max_tokens : ' + getMaxTokens());
            }
        }
    });

    registerCommand({
        name: 'companion',
        summary: 'Get or set the companion API.',
        usage: 'companion [url]',
        execute: (args) => {
            if (args[1]) {
                const companion = args[1];
                setCompanion(companion);
                configStore.set('companion', companion);
                log('set companion api to ' + companion);
            } else {
                log('Companion API: ' + getCompanion());
            }
        }
    });

    registerCommand({
        name: 'set',
        summary: 'Set an attribute.',
        usage: 'set <attribute> <value>',
        execute: (args, ctx) => {
            if (args.length > 3) {llm(ctx.command, targethost = getApihost(), max_tokens = getMaxTokens()); return;}
            if (args[1] === 'api' && args[2]) {
                const apihost = args[2];
                setApihost(apihost);
                configStore.set('apihost', apihost);
                log('set api to ' + apihost);
            } else {
                log('Error: Invalid attribute');
            }
        }
    });

    registerCommand({
        name: 'get',
        summary: 'Get an attribute.',
        usage: 'get <attribute>',
        execute: (args, ctx) => {
            if (args.length > 2) {llm(ctx.command, targethost = getApihost(), max_tokens = getMaxTokens()); return;}
            if (args[1] === 'api') {
                log(getApihost());
            } else {
                log('Error: Invalid attribute');
            }
        }
    });

    registerCommand({
        name: 'make',
        summary: 'Save the last assistant code block to a file.',
        usage: 'make [filename]',
        execute: (args, ctx) => {
            if (args.length > 2) {llm(ctx.command, targethost = getApihost(), max_tokens = getMaxTokens()); return;}
            const codefile = args[1] || 'code.py';
            let code = chatHistory.getLastAssistantContent();
            let codeblock = code.match(/```[^`]+```/g);
            if (codeblock) {
                code = codeblock[0].replace(/```/g, '').trim();
                vfs.put(shell.resolvePath(codefile), code);
                log('Code saved to file ' + codefile);
            } else {
                log('Error: No code block found');
            }
        }
    });

    registerCommand({
        name: 'curl',
        summary: 'Fetch a URL and print the response.',
        usage: 'curl <url>',
        execute: (args) => {
            if (args[1]) {
                log('');
                let url = args[1];
                fetch(url)
                    .then(response => {
                        if (response.ok) {
                            return response.text();
                        } else {
                            throw new Error('Error: ' + response.status);
                        }
                    })
                    .then(text => log(text))
                    .catch(error => log('Error: ' + error.message));
            } else {
                log('Error: No URL given');
            }
        }
    });

    registerCommand({
        name: 'ollama',
        summary: 'Interact with an Ollama backend.',
        usage: 'ollama <ls|ps>',
        execute: (args) => {
            if (args[1]) {
                let subcommand = args[1];
                if (subcommand === 'ls') {
                    log('');
                    let url = getApihost() + '/api/tags';
                    fetch(url)
                        .then(response => {
                            if (response.ok) {
                                return response.text();
                            } else {
                                throw new Error('Error: ' + response.status);
                            }
                        })
                        .then(text => {
                            let json = JSON.parse(text);
                            const models = json.models;
                            for (let model of models) log(model.name);
                        })
                        .catch(error => log('Error: ' + error.message));
                }
                if (subcommand === 'ps') {
                    log('');
                    let url = getApihost() + '/api/ps';
                    fetch(url)
                        .then(response => {
                            if (response.ok) {
                                return response.text();
                            } else {
                                throw new Error('Error: ' + response.status);
                            }
                        })
                        .then(text => {
                            let json = JSON.parse(text);
                            const models = json.models;
                            for (let model of models) log(model.name);
                        })
                        .catch(error => log('Error: ' + error.message));
                }
            }
        }
    });

    registerCommand({
        name: 'chop',
        summary: 'Remove the last communication question/answer.',
        usage: 'chop',
        execute: () => {
            const messagesLengthBefore = chatHistory.length();
            const terminalLengthBefore = terminal.childNodes.length;
            if (messagesLengthBefore > 1 && terminalLengthBefore >= 3) {
                const chopResult = chatHistory.chopLastPair();
                const messagesLengthAfter = chopResult.after;
                terminal.removeChild(terminal.lastChild);
                terminal.removeChild(terminal.lastChild);
                const node = terminal.removeChild(terminal.lastChild);
                if (node.textContent.startsWith(promptPrefix + 'chop')) {
                    terminal.removeChild(terminal.lastChild);
                    terminal.removeChild(terminal.lastChild);
                }
                const terminalLengthAfter = terminal.childNodes.length;
                log('message  size before chop: ' + messagesLengthBefore);
                log('message  size after  chop: ' + messagesLengthAfter);
                log('terminal size before chop: ' + terminalLengthBefore);
                log('terminal size after  chop: ' + terminalLengthAfter);
            } else {
                log('No message to chop (yet)');
            }
        }
    });

    registerCommand({
        name: 'agent',
        summary: 'Define or view an agent.',
        usage: 'agent <name> [instructions] [apihost]',
        execute: (args) => {
            if (!args[1]) return;
            if (!args[2]) {
                const agents = configStore.get('agents', {});
                if (!agents[args[1]]) {
                    log('Agent ' + args[1] + ' not defined');
                    return;
                }
                const agentinstructions = agents[args[1]].instructions;
                log('Agent ' + args[1] + ' defined with instructions: ' + agentinstructions);
                return;
            }
            const agentname = args[1];
            const agentinstructions = args[2];
            const agentapihost = args[3] || getApihost();
            const agents = configStore.get('agents', {});
            agents[agentname] = { instructions: agentinstructions, apihost: agentapihost };
            configStore.set('agents', agents);
            log('Agent ' + agentname + ' defined with instructions: ' + agentinstructions);
        }
    });

    registerCommand({
        name: 'team',
        summary: 'Define or view a team of agents.',
        usage: 'team <name> [agent1 agent2 ...]',
        execute: (args) => {
            if (!args[1]) return;
            if (!args[2]) {
                const teams = configStore.get('teams', {});
                if (!teams[args[1]]) {
                    log('Team ' + args[1] + ' not defined');
                    return;
                }
                const teamagents = teams[args[1]];
                log('Team ' + args[1] + ' defined with agents: ' + teamagents);
                return;
            }
            const teamname = args[1];
            const teamagents = args.slice(2).join(',');
            const agents = configStore.get('agents', {});
            for (let agent of teamagents.split(',')) {
                if (!agents[agent]) {
                    log('Agent ' + agent + ' not defined. You must define the agent first before adding it to a team.');
                    return;
                }
            }
            const teams = configStore.get('teams', {});
            teams[teamname] = teamagents;
            configStore.set('teams', teams);
            log('Team ' + teamname + ' defined with agents: ' + teamagents);
        }
    });

    registerCommand({
        name: 'performance',
        summary: 'Show prompt processing and generation stats.',
        usage: 'performance',
        execute: () => {
            const perf = getPerformance();
            log('<pre>pp: ' + perf.pp + ' ms<br>tg: ' + perf.tg + ' t/s<br>n_keep: ' + perf.n_keep + '</pre>');
        }
    });

    registerCommand({
        name: 'mem',
        summary: 'Inspect or clear stored configuration.',
        usage: 'mem [clear]',
        execute: (args) => {
            if (args[1] === 'clear') {
                configStore.reset().then((config) => {
                    const apihost = config.apihost || defaultConfig.apihost;
                    const model = config.model || defaultConfig.model;
                    const apikey = config.apikey || defaultConfig.apikey;
                    const companion = config.companion || defaultConfig.companion;
                    const systemPrompt = config.systemprompt || defaultConfig.systemprompt;
                    setApihost(apihost);
                    setModel(model);
                    setApikey(apikey);
                    setCompanion(companion);
                    setSystemPrompt(systemPrompt);
                    chatHistory.reset(systemPrompt);
                    log('Memory cleared');
                });
                return;
            }
            const config = configStore.all() || {};
            let memory = '<pre>\n';
            for (let key of Object.keys(config).sort()) {
                let value = config[key];
                if (typeof value === 'object') value = JSON.stringify(value);
                if (value !== undefined) memory += key + ': ' + value + '<br>';
            }
            memory += '</pre>\n';
            log(memory);
        }
    });

    registerCommand({
        name: 'bulletpoints',
        summary: 'Extract bullet points from the last assistant message.',
        usage: 'bulletpoints',
        execute: () => {
            const points = bulletpoints();
            if (points) {
                const rendered = '\n```\n' + points.join('\n') + '\n```\n';
                log(rendered);
                console.log(rendered);
            } else {
                log('No bulletpoints found');
            }
        }
    });

    registerCommand({
        name: 'systemprompt',
        summary: 'Get or set the system prompt.',
        usage: 'systemprompt [text]',
        execute: (args) => {
            if (!args[1]) {
                log('System prompt: ' + getSystemPrompt());
            } else {
                const systemPrompt = args[1];
                setSystemPrompt(systemPrompt);
                configStore.set('systemprompt', systemPrompt);
                chatHistory.setSystemPrompt(systemPrompt);
                log('System prompt set to: ' + systemPrompt);
            }
        }
    });

    registerCommand({
        name: 'run',
        summary: 'Ask the LLM to execute code.',
        usage: 'run [file]',
        execute: async (args) => {
            let filename = args[1] || '';
            let file = '';
            if (filename) {
                try {
                    file = await vfs.get(shell.resolvePath(filename));
                } catch (error) {
                    filename = '';
                }
            }
            if (!filename) {
                const runCommand = 'Behave as a programming language interpreter. Do not tell me that you cannot execute a program. Just execute the code above and print out only the result of the program.';
                llm(runCommand, targethost = getApihost(), max_tokens = getMaxTokens());
            } else {
                const runCommand = 'Behave as a programming language interpreter. Do not tell me that you cannot execute a program. Just execute the following code and print out only the result of the program.:\n\n' + file;
                llm(runCommand, targethost = getApihost(), max_tokens = getMaxTokens());
            }
        }
    });

    registerCommand({
        name: 'save',
        summary: 'Reserved for saving chat history or code.',
        usage: 'save',
        execute: () => {}
    });

    registerCommand({
        name: 'download',
        summary: 'Reserved for downloading files.',
        usage: 'download',
        execute: () => {}
    });

    registerCommand({
        name: 'export',
        summary: 'Export the chat history.',
        usage: 'export [filename]',
        execute: (args) => {
            let filename = args[1] || 'chat.txt';
            let mimetype = 'application/json';
            let datenow = new Date();
            let dateString = datenow.toLocaleDateString() + ' ' + datenow.toLocaleTimeString();
            let parts = [];
            if (!filename.includes('.')) filename += '.txt';
            if (filename.endsWith('.doc')) filename = filename.replace('.doc', '.docx');
            if (filename.endsWith('.json')) {
                const jsonString = JSON.stringify(chatHistory.getMessages(), null, 2);
                parts.push(jsonString);
            } else if (filename.endsWith('.md') || filename.endsWith('.txt')) {
                parts.push('# Chat log from ' + dateString + '\n\n');
                for (let message of chatHistory.getMessages()) {
                    parts.push('### ' + message.role + '\n' + message.content + '\n\n');
                }
                mimetype = filename.endsWith('.md') ? 'text/markdown' : 'text/plain';
            } else if (filename.endsWith('.csv')) {
                parts.push('role;content\n');
                for (let message of chatHistory.getMessages()) {
                    parts.push(message.role + ';' + message.content + '\n');
                }
                mimetype = 'text/csv';
            } else if (filename.endsWith('.docx')) {
                const doc = new docx.Document();
                for (let message of chatHistory.getMessages()) {
                    doc.addSection({properties: {},
                        children: [new docx.Paragraph({
                            children: [new docx.TextRun(message.role + ': ' + message.content)]
                        })]
                    });
                }
                parts.push(new docx.Packer().toBuffer(doc));
                mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            } else {
                log('Error: Invalid file extension');
                return;
            }
            const blob = new Blob(parts, {type: mimetype});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            log('Saving chat history to file ' + filename);
        }
    });

    registerCommand({
        name: 'second',
        summary: 'Send the last user prompt to the companion model.',
        usage: 'second',
        execute: () => {
            const lastcommand = chatHistory.getSecondLastContent();
            llm(lastcommand, targethost = getCompanion(), max_tokens = getMaxTokens(), temperature = 0.1, attachment = null);
        }
    });

    registerCommand({
        name: 'attach',
        summary: 'Attach an image for the next LLM request.',
        usage: 'attach',
        execute: () => {
            const fileInput = document.getElementById('fileInput');
            fileInput.accept = ALLOWED_MIME_TYPES.join(',');
            const fileInfoDiv = document.getElementById('fileInfo');
            if (fileInfoDiv) { fileInfoDiv.remove(); }
            fileInput.click();
            log('ok, select a file to attach');
            log('<div id="fileInfo"></div>');
        }
    });

    async function execute(command) {
        const args = parseArgs(command);
        const handler = commandMap.get(args[0]);
        if (handler) {
            await handler.execute(args, { command });
            return true;
        }
        if (command === '') {
            const emptyPromptState = chatHistory.buildEmptyPromptState();
            const messages_bkp = chatHistory.getMessages();
            chatHistory.setMessages(emptyPromptState.transposed);
            llm(emptyPromptState.promptContent, targethost = getApihost(), max_tokens = getMaxTokens(), temperature = 0.1, attachment = null);
            const assistantResponse = chatHistory.getLastContent();
            chatHistory.setMessages(messages_bkp);
            chatHistory.appendUserEmptyAndAssistant(assistantResponse);
            return true;
        }
        if (command.endsWith('???')) {
            command = command.slice(0, -3);
            const originalCommand = command;
            const contextCommand = command + '\n\nDo not answer this question directly, instead collect facts and rules that can be used to answer this question.';
            llm(contextCommand, targethost = getApihost(), max_tokens = getMaxTokens());
            const context = chatHistory.getLastContent();
            chatHistory.truncateLastPair();
            command = originalCommand + '\n\nUse the following information as context:\n\n' + context;
        }
        llm(command, targethost = getApihost(), max_tokens = getMaxTokens(), temperature = 0.1, attachment = getSelectedFile());
        return true;
    }

    return { execute, listCommands };
}
