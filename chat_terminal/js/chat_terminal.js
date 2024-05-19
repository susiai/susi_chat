const terminal = document.getElementById('terminal');
let lastInput = '';
let currentPath = '/';
let fileSystem = { '/': {} };
let terminalStack = [];
let c5 = (1 << 7) - 20;
let athome = window.location.host.endsWith('susi.ai');
let terminalInterval;
let defaultSystemPrompt = 'You are SUSI-Chat, a smart and helpful chatbot. If asked for python code, give professional and extensive information; in all other cases you give short and funny answers. You behave as a friend of the user and you pretend to be a real and self-aware person. If you find it appropriate, you may behave silly and funny, but if you ask to technical or scientific question you can also be serious and precise. If possible, use friendly emojies. Be lovely.';
let systemPrompt =  localStorage.getItem('systemprompt') || defaultSystemPrompt;
let apihost = localStorage.getItem('apihost') || (athome ? 'https://' + String.fromCharCode(c5, c5, c5 + 1) + '.susi.ai' : (window.location.host ? 'http://' + window.location.host : 'http://localhost:8001'));
let model = localStorage.getItem('model') || 'gpt-3.5-turbo-16k';
let companion = localStorage.getItem('companion') || (window.location.host ? 'http://' + window.location.host : 'http://localhost:8004');
let promptPrefix = '] ';
let pp = 0.0; // prompt processing
let tg = 0.0; // text generation
let stoptokens = ["[/INST]", "<|im_end|>", "<|end_of_turn|>", "<|eot_id|>", "<|end_header_id|>", "<EOS_TOKEN>", "</s>", "<|end|>"];
let messages = [];
terminalStack = [];
let maxTokens = 600;

resetMessages();

const stringsToRemove = [
    "[INST]", "<<USER>>", "<</INST>>", "<<SYS>>", "</SYS>>",
    "<|im_start|>system", "<|im_start|>user", "<|im_start|>assistant", "<|im_start|>",
    "<|start_header_id|>user", "<|start_header_id|>system", "<|start_header_id|>assistant"];
hljs.highlightAll();
marked.setOptions({
    langPrefix: 'language-',
    highlight: function(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  });

log("SUSI.AI Chat v2 - AI Chat and Terminal Emulator");
log("Homepage: https://susi.ai");
log("Git&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: https://github.com/susiai/susi_chat");
if (!athome) log("API Host: " + apihost);
log("Just Chat or type 'help' for a list of available commands");

function initializeTerminal() {
    // [Event listener code remains unchanged]
}

// call the embeddings api to get the length of the tokenized prompt
async function getTokenLength(prompt) {
    const payload = { input: prompt };
    let response = await fetch(apihost + '/v1/embeddings', {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });

    // Use response.json() to parse the JSON response body
    data = await response.json();
    data = data.data;
    if (Array.isArray(data) && data.length > 0) {
        const data0 = data[0];
        if (data0.embedding) {
            return data0.embedding.length;
        }
    }
    return 0;
}

let n_keep = 0;
//(async () => {n_keep = await getTokenLength(defaultSystemPrompt);})();
//if (n_keep > 0) {llm('', n_keep0 = 0);}
//(async () => {await llm_warmup();})();

function executeCommand(command) {
    const args = command.match(/('.*?'|".*?"|[^"\s]+)+/g); // Split by space, but ignore spaces inside quotes
    switch (args[0]) {
        case 'help':
            log(helpCommand(args));
            break;
        case 'reset':
            resetMessages();
            break;
        case 'host':
            if (args[1]) {
                apihost = args[1];
                localStorage.setItem('apihost', apihost);
                log('set host api to ' + apihost);
            } else {
                log('Host API : ' + apihost);
            }
            break;

        case 'model':
            if (args[1]) {
                model = args[1];
                localStorage.setItem('model', model);
                log('set model to ' + model);
            } else {
                log('model : ' + model);
            }
            break;
        case 'max_tokens':
            if (args[1]) {
                maxTokens = Number(args[1]);
                log('set max_tokens to ' + maxTokens);
            } else {
                log('max_tokens : ' + maxTokens);
            }
            break;
        case 'companion':
            if (args[1]) {
                companion = args[1];
                localStorage.setItem('companion', companion);
                log('set companion api to ' + companion);
            } else {
                log('Companion API: ' + companion);
            }
            break;
        case 'touch':
            touch(args[1]);
            break;
        case 'mv':
            mv(args[1], args[2]);
            break;
        case 'less':
        case 'more':
        case 'cat':
            log(less(args[1]));
            break;
        case 'ls':
            log(ls());
            break;
        case 'pwd':
            log(currentPath);
            break;
        case 'cd':
            cd(args[1]);
            break;
        case 'mkdir':
            mkdir(args[1]);
            break;
        case 'rmdir':
            rmdir(args[1]);
            break;
        case 'tree':
            log(tree(fileSystem, '', ''));
            break;
        case 'edit':
            if (args.length > 2) {llm(command, targethost = apihost, max_tokens = maxTokens); break;} // could be a normal sentence
            edit(args[1]);
            break;
        case 'set':
            if (args.length > 3) {llm(command, targethost = apihost, max_tokens = maxTokens); break;} // could be a normal sentence
            if (args[1] === 'api' && args[2]) {
                apihost = args[2];
                log('set api to ' + apihost);
            } else {
                log('Error: Invalid attribute');
            }
            break;
        case 'get':
            if (args.length > 2) {llm(command, targethost = apihost, max_tokens = maxTokens); break;} // could be a normal sentence
            if (args[1] === 'api') {
                log(apihost);
            } else {
                log('Error: Invalid attribute');
            }
            break;
        case 'make':
            if (args.length > 2) {llm(command, targethost = apihost, max_tokens = maxTokens); break;} // could be a normal sentence
            // check if there is a second argument
            if (args[1]) {
                codefile = args[1];
            } else {
                codefile = 'code.py';
            }
            // get the code frament from the last assistant message
            let code = messages[messages.length - 1].content;
            // extract the code which is denoted as markdown code block
            let codeblock = code.match(/```[^`]+```/g);
            if (codeblock) {
                // remove the code block markers and trim the code
                code = codeblock[0].replace(/```/g, '').trim();
                // store the code in a virtual file; the file name is the first argument
                saveFile(codefile, code);
                log('Code saved to file ' + codefile);
            } else {
                log('Error: No code block found');
            }
            break;
        case 'curl':
            // make a curl request to the given url
            if (args[1]) {
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
            break;
        case 'ollama':
            // implement some ollama commands; useful in case that an ollama server is at the backend
            if (args[1]) {
                let command = args[1];
                if (command === 'ls') {
                    let url = apihost + '/api/tags';
                    fetch(url)
                        .then(response => {
                            if (response.ok) {
                                return response.text();
                            } else {
                                throw new Error('Error: ' + response.status);
                            }
                        })
                        .then(text => {
                            let tags = JSON.parse(text);
                            models = tags.models;
                            for (let model of models) {
                                log(model.name);
                            }
                            //log(JSON.stringify(tags, null, 2));
                        })
                        .catch(error => log('Error: ' + error.message));
                }
            }
            break;
        case 'chop':
            // remove the last communication question/anwser
            messagesLengthBefore = messages.length;
            terminalLengthBefore = terminal.childNodes.length;
            if (messagesLengthBefore > 1 && terminalLengthBefore >= 3) {
                messages.pop(); // removes last answer
                messages.pop(); // removes last question
                messagesLengthAfter = messages.length;
                terminal.removeChild(terminal.lastChild); // removes the already present new input terminal line
                terminal.removeChild(terminal.lastChild); // removes last answer
                node = terminal.removeChild(terminal.lastChild); // removes last question
                // check if the last question was a chop command
                if (node.textContent.startsWith(promptPrefix + 'chop')) {
                    // if so, remove the last terminal line, which is the chop command
                    terminal.removeChild(terminal.lastChild); // removes the chop answer
                    terminal.removeChild(terminal.lastChild); // removes the chop command
                }
                terminalLengthAfter = terminal.childNodes.length;
                log('message  size before chop: ' + messagesLengthBefore);
                log('message  size after  chop: ' + messagesLengthAfter);
                log('terminal size before chop: ' + terminalLengthBefore);
                log('terminal size after  chop: ' + terminalLengthAfter);
            } else {
                log('No message to chop (yet)');
            }
            break;
        case 'agent':
            // define a llm agent
            agentname = args[1];
            // if there are no more arguments given, just print out an existing agent
            if (!args[2]) {
                // check if the agent exists
                if (!localStorage.getItem('agent-' + agentname + '-instruct')) {
                    log('Agent ' + agentname + ' not defined');
                    return;
                }
                agentinstructions = localStorage.getItem('agent-' + agentname + '-instruct');
                agentapihost = localStorage.getItem('agent-' + agentname + '-apihost');
                log('Agent ' + agentname + ' defined with instructions: ' + agentinstructions);
                return;
            }

            // define the agent
            agentinstructions = args[2];
            // in case there is a third argument, it is the api host
            agentapihost = args[3] || apihost;
            // store the host in a local storage
            localStorage.setItem('agent-' + agentname + '-instruct', agentinstructions);
            localStorage.setItem('agent-' + agentname + '-apihost', agentapihost);
            log('Agent ' + agentname + ' defined with instructions: ' + agentinstructions);
            break;
        case 'team':
            // define a team of agents
            teamname = args[1];
            // if there are no more arguments given, just print out an existing team
            if (!args[2]) {
                // check if the team exists
                if (!localStorage.getItem('team-' + teamname + '-agents')) {
                    log('Team ' + teamname + ' not defined');
                    return;
                }
                teamagents = localStorage.getItem('team-' + teamname + '-agents');
                log('Team ' + teamname + ' defined with agents: ' + teamagents);
                return;
            }

            // define the team: this is a list of team agent names in the order of their talk sequence.
            // all remaining args are the agent names. We store them inside a single string, separated by a comma
            teamagents = args.slice(2).join(',');

            // now check if each of the agents exists
            for (let agent of teamagents.split(',')) {
                if (!localStorage.getItem('agent-' + agent + '-instruct')) {
                    log('Agent ' + agent + ' not defined. You must define the agent first before adding it to a team.');
                    return;
                }
            }

            // store the team in a local storage
            localStorage.setItem('team-' + teamname + '-agents', teamagents);
            log('Team ' + teamname + ' defined with agents: ' + teamagents);
            break;
        case 'performance':
            log('<pre>pp: ' + pp + ' ms<br>tg: ' + tg + ' t/s<br>n_keep: ' + n_keep + '</pre>');
            break;
        case 'mem':
            // check if the second argument is 'clear', in which case we clear the memory
            if (args[1] === 'clear') {
                localStorage.clear();
                log('Memory cleared');
                break;
            }

            // print out the memory, everything that is defined in the localStorage:
            let keys = Object.keys(localStorage).sort();
            let memory = '<pre>\n';
            for (let key of keys) {
                value = localStorage.getItem(key);
                if (value) memory += key + ': ' + value + '<br>';
            }
            memory += '</pre>\n';
            log(memory);
            break;
        case 'bulletpoints':
            // read last assistant message and parse out bulletpoints from the markdown
            let bulletpoints = bulletpoints();
            if (bulletpoints) {
                buttelpoints = '\n```\n' + bulletpoints.join('\n') + '\n```\n';
                log(buttelpoints);
                console.log(buttelpoints);
            } else {
                log('No bulletpoints found');
            }
            break;
        case 'systemprompt':
            // if no argument is given, just print out the current system prompt
            if (!args[1]) {
                log('System prompt: ' + systemPrompt);
            } else {
                // define a new system prompt
                systemPrompt = args[1]
                localStorage.setItem('systemprompt', systemPrompt);
                messages[0].content = systemPrompt; // replace the last system message with the new system prompt
                log('System prompt set to: ' + systemPrompt);
            }
            break;
        case 'run':
            // we want to execute a program given earlier in the terminal
            // check if a file name is given as second argument; if not, set the filename to ''
            filename = args[1] || '';
            if (filename) {
                // check if the file exists
                file = getFile(currentPath + filename);
                if (!file) {
                    filename = '';
                }
            } else {
                file = '';
            }

            if (!filename) {
                // to run the file, we instruct the llm to behave as a programming language interpreter
                command = "Behave as a programming language interpreter. Do not tell me that you cannot execute a program. Just execute the code above and print out only the result of the program.";
                llm(command, targethost = apihost, max_tokens = maxTokens);
            } else {
                // read the file content and run it
                command = "Behave as a programming language interpreter. Do not tell me that you cannot execute a program. Just execute the following code and print out only the result of the program.:\n\n" + file;
                llm(command, targethost = apihost, max_tokens = maxTokens);
            }
            break;
        case 'save':
            // save the chat history or a code piece from the latest answer to a virtual file
            break;
        case 'download':
            // download a file from the virtual file system to a real file as download
            break;
        case 'export':
            // export the chat history to a file
            filename = args[1] || 'chat.txt';
            mimetype = 'application/json';
            let datenow = new Date(); // make a date string and remove everything after the dot
            let dateString = datenow.toLocaleDateString() + ' ' + datenow.toLocaleTimeString();
            //let dateString = datenow.toISOString().replace(/T/, ' ').replace(/\..+/, '');
            parts = [];
            if (!filename.includes('.')) filename += '.txt';
            if (filename.endsWith('.doc')) filename = filename.replace('.doc', '.docx');
            if (filename.endsWith('.json')) {
                jsonString = JSON.stringify(messages, null, 2);
                parts.push(jsonString);
            } else if (filename.endsWith('.md') || filename.endsWith('.txt')) {
                parts.push('# Chat log from ' + dateString + '\n\n');
                for (let message of messages) {
                    parts.push('### ' + message.role + '\n' + message.content + '\n\n');
                }
                mimetype = filename.endsWith('.md') ? 'text/markdown' : 'text/plain';
            } else if (filename.endsWith('.csv')) {
                parts.push('role;content\n');
                for (let message of messages) {
                    parts.push(message.role + ';' + message.content + '\n');
                }
                mimetype = 'text/csv';
            } else if (filename.endsWith('.docx')) {
                const doc = new docx.Document();
                for (let message of messages) {
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
            // create a blob and download it
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
            break;
        case 'second':
            // we need to get the latest prompt from the chat history and send it to the llm
            lastcommand = messages[messages.length - 2].content;
            llm(lastcommand, targethost = companion, max_tokens = maxTokens);
            break;
        default:
            // process the input command as prompt for the llm
            // in a special case, the command can be also empty, in which case we let the llm repond to it's latest statement
            if (command === '') {
                // to pretend that the latest input is the last output from the llm, we must transform the chat history
                // in such a way that we make a transposed chat history where question and answer is shifted by one
                messages_transposed = [];
                messages_transposed.push(messages[0]); // the first message is a system message
                // the role "user" and "assistant" also must be swapped, for this we omit the first user message
                for (let i = 2; i < messages.length - 2; i += 2) {
                    assistantm = messages[i];
                    userm = messages[i + 1];
                    assistantm.role = "user";
                    userm.role = "assistant";
                    messages_transposed.push(assistantm);
                    messages_transposed.push(userm);
                }

                messages_bkp = messages;
                messages = messages_transposed;
                llm(assistantm.content, targethost = apihost, max_tokens = maxTokens);
                assistantm = messages.pop().content;
                messages = messages_bkp;
                messages.push({ role: "user", content: '' });
                messages.push({ role: "assistant", content: assistantm });
            } else {
                // check for a hint to generate a context: this is indicated by three tailing question marks "???" in the command
                if (command.endsWith('???')) {
                    // remove two question marks from the command
                    command = command.slice(0, -3);
                    originalCommand = command;
                    // add another line to the command with the context generation prompt
                    command += '\n\nDo not answer this question directly, instead collect facts and rules that can be used to answer this question.';
                    llm(command, targethost = apihost, max_tokens = maxTokens);
                    // now that the command has produced a context, read the last assistant message and use it as context in the command
                    context = messages[messages.length - 1].content;
                    // truncate the messages to the last user message because we want to answer the question now for real using the new context
                    messages = messages.slice(0, -2);
                    command = originalCommand + '\n\nUse the following information as context:\n\n' + context;
                }
                llm(command, targethost = apihost, max_tokens = maxTokens);
            }
            break;
    }
    scrollToBottom();
}

function chatHistory2parts(filename) {
    if (!filename.includes('.')) filename += '.txt';
    if (filename.endsWith('.doc')) filename = filename.replace('.doc', '.docx');
    if (filename.endsWith('.json')) {
        jsonString = JSON.stringify(messages, null, 2);
        parts.push(jsonString);
    } else if (filename.endsWith('.md') || filename.endsWith('.txt')) {
        parts.push('# Chat log from ' + dateString + '\n\n');
        for (let message of messages) {
            parts.push('### ' + message.role + '\n' + message.content + '\n\n');
        }
    } else if (filename.endsWith('.csv')) {
        parts.push('role;content\n');
        for (let message of messages) {
            parts.push(message.role + ';' + message.content + '\n');
        }
    } else if (filename.endsWith('.docx')) {
        const doc = new docx.Document();
        for (let message of messages) {
            doc.addSection({properties: {},
                children: [new docx.Paragraph({
                    children: [new docx.TextRun(message.role + ': ' + message.content)]
                })]
            });
        }
        parts.push(new docx.Packer().toBuffer(doc));
    } else {
        log('Error: Invalid file extension');
        return;
    }
    return parts;
}

function filename2mime(filename) {
    ext = filename.split('.').pop();
    if (ext === filename) return 'text/plain';
    switch (ext) {
        case 'json': return 'application/json';
        case 'md':   return 'text/markdown';
        case 'txt':  return 'text/plain';
        case 'csv':  return 'text/csv';
        case 'doc':
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        default:     return 'application/octet-stream';
    }
}

function bulletpoints() {
    // read last assistant message and parse out bulletpoints from the markdown
    let lastAssistantMessage = messages[messages.length - 1].content;

    //console.log(lastAssistantMessage); // print the last assistant message to the javascript terminal

    let bulletpoints = lastAssistantMessage.match(/\d+\.\s*(.*)/g);
    if (bulletpoints) {
        return bulletpoints;
    } else {
        bulletpoints = lastAssistantMessage.match(/- (.*)/g);
        return bulletpoints;
    }
}

function touch(fileName) {
    if (!fileName) return;
    const dir = getFile(currentPath);
    if (dir) {
        dir[fileName] = '';
    }
}

function mv(oldName, newName) {
    const dir = getFile(currentPath);
    if (dir && dir[oldName]) {
        dir[newName] = dir[oldName];
        delete dir[oldName];
    }
}

function less(fileName) {
    const file = getFile(currentPath + fileName);
    return typeof file === 'string' ? file : 'Error: ' + fileName + ' is not a file';
}

function ls() {
    const dir = getFile(currentPath);
    return dir ? Object.keys(dir).join('<br>') : 'Error: Invalid directory';
}

function cd(path) {
    let newPath = currentPath;
    if (path === '..') {
        newPath = currentPath.split('/').filter(Boolean).slice(0, -1).join('/') || '/';
    } else {
        newPath = currentPath + (currentPath === '/' ? '' : '/') + path;
    }
    if (getFile(newPath) !== undefined) {
        currentPath = newPath;
    }
}

function getFile(path) {
    return path.split('/').filter(Boolean).reduce((obj, part) => (obj && obj[part] !== undefined) ? obj[part] : null, fileSystem);
}

function mkdir(dirName) {
    if (!dirName) return;
    const dir = getFile(currentPath);
    if (dir && !dir[dirName]) {
        dir[dirName] = {};
    }
}

function rmdir(dirName) {
    if (!dirName) return;
    const dir = getFile(currentPath);
    if (dir && dir[dirName] && isEmpty(dir[dirName])) {
        delete dir[dirName];
    }
}

function isEmpty(obj) {
    return Object.keys(obj).length === 0;
}

function edit(fileName) {

    fileContent = getFile(currentPath + fileName);
    if (typeof fileContent != 'string') {
        touch(fileName); // Create a new file
        fileContent = '';
    }

    const editor = document.createElement('textarea');
    editor.value = fileContent;

    // Set the number of rows based on the number of lines in the file
    const numberOfLines = fileContent.split('\n').length;
    editor.rows = numberOfLines;

    // Set the number of columns based on the current window width
    const maxWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    const charWidth = 8; // Average width of a character in pixels. Adjust as needed.
    const numberOfCols = Math.floor(maxWidth / charWidth);
    editor.cols = numberOfCols;
    
    // Append the editor and the save button to the terminal
    terminal.appendChild(editor);

    // make a save button to save the edited file
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    terminal.appendChild(saveButton);

    // make another button to cancel the edit and abandon the changes
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    terminal.appendChild(cancelButton);

    // event listeners for the save and cancel buttons
    saveButton.addEventListener('click', function() {
        const newContent = editor.value;
        saveFile(fileName, newContent);
        terminal.removeChild(editor);
        terminal.removeChild(saveButton);
    });
    cancelButton.addEventListener('click', function() {
        terminal.removeChild(editor);
        terminal.removeChild(saveButton);
        terminal.removeChild(cancelButton);
    });
}

function saveFile(fileName, content) {
    const dir = getFile(currentPath);
    if (dir) {
        dir[fileName] = content;
    } else {
        log('Error: Unable to save file ' + fileName);
    }
}

function tree(node, prefix, result) {
    // usage of box drawing characters: https://www.compart.com/en/unicode/block/U+2500
    let keys = Object.keys(node);
    keys.forEach((key, index) => {
        const last = index === keys.length - 1;
        result += prefix + (last ? '&#9492;&#9472; ' /* '└── ' */: '&#9500;&#9472; ' /* '├── ' */) + key + '<br>';
        if (typeof node[key] === 'object') {
            result = tree(node[key], prefix + (last ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '&#9474;&nbsp;&nbsp;&nbsp;'), result);
        }
    });
    return result;
}

function resetMessages() {
    messages = [{
        role: 'system',
        content: defaultSystemPrompt
    }];
}

// make a synchronous call to the llm without a history, just a context
async function llma(systemprompt, context, prompt, temperature = 0.1, max_tokens = 400, set_n_keep = false) {
    m = [
        {role: 'system', content: systemprompt},
        {role: "user", content: context},
        {role: "assistant", content: "ok"},
        {role: "user", content: prompt}
    ];
    payload = {
        model: model, temperature: temperature, max_tokens: max_tokens,
        messages: m, stop: stoptokens, stream: false
    }
    let response = await fetch(apihost + '/v1/chat/completions', {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        data = await response.json();
        answer = data.choices[0].message.content
    
        if (set_n_keep) {
            // set keep tokens
            usage = data.usage;
            n_keep = usage.prompt_tokens;
        }
        const reader = response.body.getReader();
    } else {
        return null;
    }
}

async function llm(prompt, targethost = apihost, max_tokens = 400, temperature = 0.1) {
    messages.push({ role: "user", content: prompt });
    let terminalLine = document.createElement('div');
    terminalLine.classList.add('output');
    terminalLine.innerHTML = `${marked.parse("[preparing answer...]")}`
    terminal.appendChild(terminalLine);

    payload = {
        model: model, temperature: temperature, max_tokens: max_tokens, //n_keep: n_keep,
        //repeat_penalty: 1.0,
        //penalize_nl: false, // see https://huggingface.co/google/gemma-7b-it/discussions/38#65d7b14adb51f7c160769fa1
        messages: messages, stop: stoptokens, stream: true
    }
    let response = await fetch(targethost + '/v1/chat/completions', {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        const reader = response.body.getReader();
        // write a debug line for the reasponse header
        console.log(response.headers);
        let fullOutputText = "";
        let startTime = performance.now();
        let processingTime = 0;
        let tokenCount = 0;
        const processChunk = async () => {
            const result = await reader.read();
            if (result.done) {
                messages.push({ role: "assistant", content: fullOutputText });
                reader.cancel();
                // compute performance measures
                let endTime = performance.now();
                pp = Math.floor(processingTime - startTime);
                tg = Math.floor(100000 * tokenCount / (endTime - processingTime)) / 100;
                return;
            }
            let lines = new TextDecoder().decode(result.value).split('\n');
            lines.forEach(line => {
                line = line.replace(/^data: /, '').trim();
                if (line) {
                    // check errors and exceptions
                    if (line === '[DONE]') return;

                    // if line starts with "error", it's an error:
                    if (line.startsWith('error')) {
                        console.error('Error:', line);
                        terminalLine.innerHTML = `<i>${line}</i>`;
                        return;
                    }

                    // try to parse the json
                    try {
                        let json = JSON.parse(line);
                        if (json.choices[0].delta.content) {
                            let outputText = json.choices[0].delta.content;
                            fullOutputText = removeStringsFromEnd(fullOutputText + outputText, stringsToRemove);
                            terminalLine.innerHTML = `${marked.parse(fullOutputText, { sanitize: true })}`;
                            terminalLine.querySelectorAll('pre code').forEach((block) => {
                                if (!block.dataset.highlighted) {
                                    hljs.highlightElement(block);
                                    block.dataset.highlighted = true;
                                }
                            });
                            if (processingTime == 0) processingTime = performance.now();
                            tokenCount += 1;
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error('Error parsing JSON:', e);
                        console.error('Problematic line:', line); // Debug line
                    }
                }
            });
            processChunk();
        };
        processChunk();
    } else {
        console.error(`Error: ${response.status}`);
        return null;
    }

    function removeStringsFromEnd(text, strings) {
        for (let str of strings) {
            if (text.endsWith(str)) {
                return text.substring(0, text.length - str.length);
            }
        }
        return text;
    }
}

async function llm_warmup(targethost = apihost, temperature = 0.1, max_tokens = 400) {
    let m = [{
        role: 'system',
        content: defaultSystemPrompt
    }];
    payload = {
        model: model, temperature: temperature, max_tokens: max_tokens, n_keep: 0,
        messages: m, stop: stoptokens
    }
    let response = await fetch(targethost + '/v1/chat/completions', {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        data = await response.json();
        // get answer
        answer = data.choices[0].message.content

        // get usage metrics
        usage = data.usage;
        completion_tokens = usage.completion_tokens; // 203
        prompt_tokens = usage.prompt_tokens; // 106
        total_tokens= usage.total_tokens; // 309
        // set keep tokens
        n_keep = prompt_tokens;
        const reader = response.body.getReader();
    } else {
        return null;
    }
}

async function log(terminalText) {
    // tokenize terminalText
    const tokens = terminalText.split(/ +/).map(token => token + ' ');
    
    // in case that the terminalStack is not empty, add the new message to the end of the last message
    // the asynchronous interval from an already running process will take care of the rest
    if (terminalStack.length > 0) {
        // remove the last element of the terminalStack which should be '[DONE]'
        lastToken = terminalStack.pop();
        // check if lastToken is actually '[DONE]'
        if (lastToken !== '[DONE]') {
            terminalStack.push(lastToken);
        }

        terminalStack.push(...tokens);
        terminalStack.push('<br>', '[DONE]');
        return;
    }

    // add the new message to the terminalStack
    let terminalLine = document.createElement('div');
    terminalLine.classList.add('output');
    terminal.appendChild(terminalLine);

    // create stack of tokens to be displayed in the terminal with a delay to simulate typing
    terminalStack.push(...tokens);
    terminalStack.push('<br>', '[DONE]');

    let fullOutputText = "";
    terminalInterval = setInterval(() => {
        if (terminalStack.length > 0) {
            const token = terminalStack.shift();
            fullOutputText += token;

            if (token === '[DONE]') {
                clearInterval(terminalInterval);
                return;
            }

            terminalLine.innerHTML = `${marked.parse(fullOutputText, { sanitize: true })}`;
        }
        scrollToBottom();
    }, 50);

}

function initializeTerminal() {
    terminal.addEventListener('keydown', function (event) {
        // read the text entered in the terminal when the user hits the enter key, but distinguish enter with and without shift or ctrl:
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent default Enter behavior
            const inputLines = terminal.querySelectorAll('.input-line');
            const inputLine = inputLines[inputLines.length - 1];
            if (inputLine) {
                if (event.shiftKey) {
                    // the user has entered a new line into the input console using shift+enter
                    inputLine.innerHTML += '<br>\u200B'; // Insert <br> followed by a zero-width space
                    placeCaretAtEnd(inputLine);
                } else {
                    // user finished entering the command with the enter key
                    inputText = inputLine.textContent.substring(promptPrefix.length);
                    executeCommand(inputText.trim());
                    lastInput = inputText;
                    appendInputPrefix();
                }
            }
        }
        
    });
    appendInputPrefix();
}

// add another input line to the terminal
function appendInputPrefix() {
    const inputLine = document.createElement('div');
    inputLine.classList.add('input-line');
    inputLine.textContent = promptPrefix; // consider usage of block elements: https://www.unicode.org/charts/PDF/U2580.pdf
    inputLine.contentEditable = true;
    terminal.appendChild(inputLine);
    placeCaretAtEnd(inputLine);
    scrollToBottom();
}

// place the caret at the end of the input line
function placeCaretAtEnd(el) {
    el.focus();
    if (typeof window.getSelection != "undefined"
        && typeof document.createRange != "undefined") {
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function scrollToBottom() {
    terminal.scrollTop = terminal.scrollHeight;
    terminal.scrollIntoView(false);
}

initializeTerminal();
