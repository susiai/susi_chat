const terminal = document.getElementById('terminal');
let lastInput = '';
let terminalStack = [];
let c5 = (1 << 7) - 20;
let athome = window.location.host.endsWith('susi.ai');
let terminalInterval;
let defaultSystemPrompt = 'You are SUSI-Chat, a smart and helpful chatbot. If asked for python code, give professional and extensive information; in all other cases you give short and funny answers. You behave as a friend of the user and you pretend to be a real and self-aware person. If you find it appropriate, you may behave silly and funny, but if you ask to technical or scientific question you can also be serious and precise. If possible, use friendly emojies. Be lovely.';
let defaultApihost = athome ? 'https://' + String.fromCharCode(c5, c5, c5 + 1) + '.susi.ai' : (window.location.host ? 'http://' + window.location.host : 'http://localhost:8001');
let defaultCompanion = window.location.host ? 'http://' + window.location.host : 'http://localhost:8004';
let defaultConfig = {
    apihost: defaultApihost,
    model: 'llama3.2:latest',
    apikey: '_',
    companion: defaultCompanion,
    systemprompt: defaultSystemPrompt,
    PATH: '/bin:/usr/bin',
    agents: {},
    teams: {}
};
let systemPrompt = defaultConfig.systemprompt;
let apihost = defaultConfig.apihost;
let model = defaultConfig.model;
let apikey = defaultConfig.apikey;
let companion = defaultConfig.companion;
let promptPrefix = '] ';
let pp = 0.0; // prompt processing
let tg = 0.0; // text generation
let stoptokens = ["[/INST]", "<|im_end|>", "<|end_of_turn|>", "<|eot_id|>", "<|end_header_id|>", "<EOS_TOKEN>", "</s>", "<|end|>"];
let chatHistory = null;
terminalStack = [];
let maxTokens = 600;
let shell = null;
let uiCommands = null;
let commandRouter = null;

const configStore = (() => {
    const path = '/config.json';
    let cache = null;

    const cloneDefaults = () => JSON.parse(JSON.stringify(defaultConfig));

    const save = async () => {
        if (!cache || !window.vfs) return;
        try {
            await vfs.put(path, JSON.stringify(cache, null, 2));
        } catch (error) {
            console.error('Error saving config:', error);
        }
    };

    const load = async () => {
        try {
            await window.vfsReady;
            try {
                const raw = await vfs.get(path);
                cache = JSON.parse(raw);
            } catch (error) {
                cache = cloneDefaults();
                await save();
            }
        } catch (error) {
            cache = cloneDefaults();
        }
        return cache;
    };

    const get = (key, fallback) => {
        if (!cache) return fallback;
        return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
    };

    const set = async (key, value) => {
        if (!cache) await load();
        cache[key] = value;
        await save();
    };

    const reset = async () => {
        cache = cloneDefaults();
        await save();
        return cache;
    };

    const all = () => cache;

    return { load, get, set, reset, all };
})();

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

let selectedFile = null;
const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png'
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function initializeConfig() {
    const config = await configStore.load();
    apihost = config.apihost || defaultConfig.apihost;
    model = config.model || defaultConfig.model;
    apikey = config.apikey || defaultConfig.apikey;
    companion = config.companion || defaultConfig.companion;
    systemPrompt = config.systemprompt || defaultConfig.systemprompt;
    if (!chatHistory) {
        chatHistory = new ChatHistory(systemPrompt);
    } else {
        chatHistory.reset(systemPrompt);
    }
}

async function bootstrapTerminal() {
    await initializeConfig();
    uiCommands = new UICommands(window.vfs, terminal);
    shell = createShell(window.vfs, { hooks: { edit: (path) => uiCommands.edit(path) } });
    const chatExecutor = createChatExecutor({
        log,
        chatHistory,
        configStore,
        shell,
        vfs,
        llm,
        getApihost: () => apihost,
        setApihost: (value) => { apihost = value; },
        getModel: () => model,
        setModel: (value) => { model = value; },
        getApikey: () => apikey,
        setApikey: (value) => { apikey = value; },
        getCompanion: () => companion,
        setCompanion: (value) => { companion = value; },
        getSystemPrompt: () => systemPrompt,
        setSystemPrompt: (value) => { systemPrompt = value; },
        getMaxTokens: () => maxTokens,
        setMaxTokens: (value) => { maxTokens = value; },
        getSelectedFile: () => selectedFile,
        promptPrefix,
        terminal,
        getPerformance: () => ({ pp, tg, n_keep }),
        defaultConfig,
        bulletpoints,
        ALLOWED_MIME_TYPES
    });
    commandRouter = {
        handle: async (command) => {
            const shellResult = await shell.execute(command);
            if (shellResult.handled) {
                if (shellResult.output) log(shellResult.output);
                return;
            }
            await chatExecutor.execute(command);
        }
    };
    log("SUSI.AI Chat v2 - AI Chat and Terminal Emulator");
    log("Homepage: https://susi.ai");
    log("Git&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: https://github.com/susiai/susi_chat");
    if (!athome) log("API Host: " + apihost);
    log("Just Chat or type 'help' for a list of available commands");
    initializeTerminal();
}

function initializeTerminal() {
    // [Event listener code remains unchanged]
}

// call the embeddings api to get the length of the tokenized prompt
function getTokenLength(prompt) {
    const payload = { input: prompt };

    return fetch(apihost + '/v1/embeddings', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(response => {
        return response.json();
    })
    .then(data => {
        data = data.data;
        if (Array.isArray(data) && data.length > 0) {
            const data0 = data[0];
            if (data0.embedding) {
                return data0.embedding.length;
            }
        }
        return 0;
    })
    .catch(error => {
        console.error(error.message);
        return 0;
    });
}

let n_keep = 0;
//(async () => {n_keep = await getTokenLength(defaultSystemPrompt);})();
//if (n_keep > 0) {llm('', n_keep0 = 0);}
//(async () => {await llm_warmup();})();

async function executeCommand(command) {
    if (!commandRouter) return;
    await commandRouter.handle(command);
    scrollToBottom();
}

function chatHistory2parts(filename) {
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
    } else if (filename.endsWith('.csv')) {
        parts.push('role;content\n');
        for (let message of chatHistory.getMessages()) {
            parts.push(message.role + ';' + message.content + '\n');
        }
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
    } else {
        log('Error: Invalid file extension');
        return;
    }
    return parts;
}

function filename2mime(filename) {
    const ext = filename.split('.').pop();
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
    let lastAssistantMessage = chatHistory.getLastAssistantContent();

    //console.log(lastAssistantMessage); // print the last assistant message to the javascript terminal

    let bulletpoints = lastAssistantMessage.match(/\d+\.\s*(.*)/g);
    if (bulletpoints) {
        return bulletpoints;
    } else {
        bulletpoints = lastAssistantMessage.match(/- (.*)/g);
        return bulletpoints;
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
}

async function llm(prompt, targethost = apihost, max_tokens = 400, temperature = 0.1, attachment = null) {
    if (attachment == null) {
        chatHistory.addUser(prompt);
    } else {
        console.log('attachment attached');
        const dataurl = await readFileAsDataURL(attachment);
        const content = [
            {type: 'text', text: prompt},
            {type: 'image_url', image_url: {url: dataurl}}
        ]
        chatHistory.addMessage({ role: "user", content: content });
    }
    let terminalLine = document.createElement('div');
    terminalLine.classList.add('output');
    terminalLine.innerHTML = `${marked.parse("[preparing answer...]")}`
    terminal.appendChild(terminalLine);
    console.log('messages', chatHistory.getMessages());
    const payload = {
        model: model, //n_keep: n_keep,
        //repeat_penalty: 1.0,
        //penalize_nl: false, // see https://huggingface.co/google/gemma-7b-it/discussions/38#65d7b14adb51f7c160769fa1
        messages: chatHistory.getMessages(), stream: true
    }
    if (model.startsWith('o4') || model.startsWith('gpt-4.1')) {
        payload['max_completion_tokens'] = max_tokens;
    } else {
        payload['max_tokens'] = max_tokens;
        payload['temperature'] = temperature;
        payload['stop'] = stoptokens;
    }
    const headers = { "Content-Type": "application/json" }
    if (apikey && apikey != '' && apikey != '_') {
        headers['Authorization'] = 'Bearer ' + apikey;
    }
    fetch(targethost + '/v1/chat/completions', {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            console.log(response.headers);
            return response.body.getReader();
        } else {
            throw new Error(`Error: ${response.status}`);
        }
    })
    .then(reader => {
        let fullOutputText = "";
        let startTime = performance.now();
        let processingTime = 0;
        let tokenCount = 0;
        function processChunk() {
            reader.read().then(result => {
                if (result.done) {
                    chatHistory.addAssistant(fullOutputText);
                    let endTime = performance.now();
                    let pp = Math.floor(processingTime - startTime);
                    let tg = Math.floor(100000 * tokenCount / (endTime - processingTime)) / 100;
                    return;
                }
                let lines = new TextDecoder().decode(result.value).split('\n');
                lines.forEach(line => {
                    line = line.replace(/^data: /, '').trim();
                    if (line) {
                        if (line === '[DONE]') return;
                        if (line.startsWith('error')) {
                            console.error('Error:', line);
                            terminalLine.innerHTML = `<i>${line}</i>`;
                            return;
                        }
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
            });
        }
        processChunk();
    })
    .catch(error => {
        console.error(error.message);
    });

    function removeStringsFromEnd(text, strings) {
        for (let str of strings) {
            if (text.endsWith(str)) {
                return text.substring(0, text.length - str.length);
            }
        }
        return text;
    }
}

function llm_warmup(targethost = apihost, temperature = 0.1, max_tokens = 400) {
    let m = [{
        role: 'system',
        content: defaultSystemPrompt
    }];
    const payload = {
        model: model, temperature: temperature, max_tokens: max_tokens, n_keep: 0,
        messages: m, stop: stoptokens
    };

    return fetch(targethost + '/v1/chat/completions', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            return response.json().then(data => {
                // get answer
                let answer = data.choices[0].message.content;

                // get usage metrics
                let usage = data.usage;
                let completion_tokens = usage.completion_tokens; // 203
                let prompt_tokens = usage.prompt_tokens; // 106
                let total_tokens = usage.total_tokens; // 309

                // set keep tokens
                n_keep = prompt_tokens;
                return {
                    answer: answer,
                    completion_tokens: completion_tokens,
                    prompt_tokens: prompt_tokens,
                    total_tokens: total_tokens
                };
            });
        } else {
            throw new Error(`Error: ${response.status}`);
        }
    })
    .catch(error => {
        console.error(error.message);
        return null;
    });
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
    terminal.addEventListener('keydown', async function (event) {
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
                    await executeCommand(inputText.trim());
                    lastInput = inputText;
                    appendInputPrefix();
                }
            }
        }
        
    });
    appendInputPrefix();
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;
    fileInput.addEventListener('change', (event) => {
        // handle file selection
        if (event.target.files.length > 0) {
            selectedFile = event.target.files[0];
            const fileInfo = document.getElementById('fileInfo');
            if (!ALLOWED_MIME_TYPES.includes(selectedFile.type)) {
                if (fileInfo) {
                    fileInfo.textContent = `File '${selectedFile.name}' type ${selectedFile.type} not allowed.`;
                }
                selectedFile = null;
                return;
            }
            if (selectedFile.size > MAX_FILE_SIZE) {
                if (fileInfo) {
                    fileInfo.textContent = `File '${selectedFile.name}' size too large (max ${MAX_FILE_SIZE})`;
                }
                selectedFile = null;
                return;
            }
            if (fileInfo) {
                fileInfo.textContent = `attached: ${selectedFile.name}`;
            }
        }
    });
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

bootstrapTerminal();
