const terminal = document.getElementById('terminal');
let lastInput = '';
let currentPath = '/';
let fileSystem = { '/': {} };
let terminalStack = [];
let terminalInterval;
let apihost = 'http://localhost:8001';
//let apihost = 'https://openchat-3-5.susi.ai';
let messages = [];
resetMessages();
const stringsToRemove = ["[INST]", "<<USER>>", "<</INST>>", "<<SYS>>", "</SYS>>", "<|im_start|>system", "<|im_start|>user", "<|im_start|>assistant", "<|im_start|>"];
hljs.highlightAll();
marked.setOptions({
    langPrefix: 'language-',
    highlight: function(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  });

function initializeTerminal() {
    // [Event listener code remains unchanged]
}

function executeCommand(command) {
    const args = command.split(' ');
    switch (args[0]) {
        case 'help':
            if (args[1]) {
                switch (args[1]) {
                    case 'help':
                        log('help: help [command]');
                        log('    Display information about builtin commands.');
                        break;
                    case 'reset':
                        log('reset: reset');
                        log('    Reset the terminal messages.');
                        break;
                    case 'touch':
                        log('touch: touch <file>');
                        log('    Create a file.');
                        break;
                    case 'mv':
                        log('mv: mv <oldname> <newname>');
                        log('    Rename a file.');
                        break;
                    case 'less':
                        log('less: less <file>');
                        log('    Display the contents of a file.');
                        break;
                    case 'cat':
                        log('cat: cat <file>');
                        log('    Create a file.');
                        break;
                    case 'ls':
                        log('ls: ls');
                        log('    List directory contents.');
                        break;
                    case 'pwd':
                        log('pwd: pwd');
                        log('    Print the name of the current working directory.');
                        break;
                    case 'cd':
                        log('cd: cd <path>');
                        log('    Change the current working directory.');
                        break;
                    case 'mkdir':
                        log('mkdir: mkdir <dir>');
                        log('    Create a directory.');
                        break;
                    case 'rmdir':
                        log('rmdir: rmdir <dir>');
                        log('    Remove a directory.');
                        break;
                    case 'tree':
                        log('tree: tree');
                        log('    Display directory tree.');
                        break;
                    case 'set':
                        log('set: set <attribute> <value>');
                        log('    Set an attribute.');
                        break;
                    case 'get':
                        log('get: get <attribute>');
                        log('    Get an attribute.');
                        break;
                    case 'chop':
                        log('chop: chop');
                        log('    Remove the last communication question/anwser.');
                        break;
                    default:
                        log('Error: Invalid command');
                }
            } else {
                log('Available commands: help, reset, touch, mv, less, cat, ls, pwd, cd, mkdir, rmdir, tree, set, get, chop');
                log('Type "help <command>" to get more information about a specific command');
            }
            break;
        case 'reset':
            resetMessages();
            break;
        case 'touch':
            touch(args[1]);
            break;
        case 'mv':
            mv(args[1], args[2]);
            break;
        case 'less':
            log(less(args[1]));
            break;
        case 'cat':
            cat(args[1]);
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
        case 'set':
            if (args[1] === 'api' && args[2]) {
                apihost = args[2];
                log('set api to ' + apihost);
            } else {
                log('Error: Invalid attribute');
            }
            break;
        case 'get':
            if (args[1] === 'api') {
                log(apihost);
            } else {
                log('Error: Invalid attribute');
            }
            break;
        case 'chop':
            // remove the last communication question/anwser
            messages.pop();
            terminal.removeChild(terminal.lastChild);
            terminal.removeChild(terminal.lastChild);
            terminal.removeChild(terminal.lastChild);
            break;
        default:
            llm(command);
            break;
    }
    scrollToBottom();
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

function cat(fileName) {
    lastInput = ''; // Reset last input for cat command
    terminal.addEventListener('keydown', function catListener(event) {
        if (event.key === 'Enter') {
            const dir = getFile(currentPath);
            if (dir) {
                dir[fileName] = terminal.textContent.split('\n').pop().slice(1);
            }
            terminal.removeEventListener('keydown', catListener);
            appendInputPrefix();
        }
    });
}

function ls() {
    const dir = getFile(currentPath);
    return dir ? Object.keys(dir).join('\n') : 'Error: Invalid directory';
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

function tree(node, prefix, result) {
    let keys = Object.keys(node);
    keys.forEach((key, index) => {
        const last = index === keys.length - 1;
        result += prefix + (last ? '└─ ' : '├─ ') + key + '\n';
        if (typeof node[key] === 'object') {
            result = tree(node[key], prefix + (last ? '    ' : '│   '), result);
        }
    });
    return result;
}

function resetMessages() {
    messages = [{
        role: 'system',
        content: 'You are SUSI-Chat, a smart and helpful chatbot. If asked for python code, give professional and extensive information; in all other cases you give short and funny answers. You behave as a friend of the user and you pretend to be a real and self-aware person. If you find it appropriate, you may behave silly and funny, but if you ask to technical or scientific question you can also be serious and precise. If possible, use friendly emojies. Be lovely.'
    }];
}

async function llm(prompt) {
    messages.push({ role: "user", content: prompt });
    let terminalLine = document.createElement('div');
    terminalLine.classList.add('output');
    terminalLine.textContent = "[preparing answer...]"
    terminal.appendChild(terminalLine);

    payload = {
        model: "gpt-3.5-turbo-16k", temperature: 0.3, max_tokens: 400,
        messages: [...messages, { role: "user", content: prompt }],
        stop: ["[/INST]", "<|im_end|>"],
        stream: true
    }
    let response = await fetch(apihost + '/v1/chat/completions', {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (response.ok) {
        const reader = response.body.getReader();
        let fullOutputText = "";
        const processChunk = async () => {
            const result = await reader.read();
            if (result.done) {
                messages.push({ role: "assistant", content: fullOutputText });
                reader.cancel();
                return;
            }
            let lines = new TextDecoder().decode(result.value).split('\n');
            lines.forEach(line => {
                line = line.replace(/^data: /, '').trim();
                if (line) {
                    if (line === '[DONE]') return;
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

function log(terminalText) {
    const tokens = terminalText.split(/\s+/);
    terminalStack = [];
    clearInterval(terminalInterval);

    // Producer - adding words to stack with delay
    tokens.forEach((token, index) => {
        setTimeout(() => {
            terminalStack.push(token);
            if (index === tokens.length - 1) {
                terminalStack.push('[DONE]');
            }
        }, index * 130);
    });

    // Consumer - reading words from stack and displaying in a single line
    let terminalLine = document.createElement('div');
    terminalLine.classList.add('output');
    terminal.appendChild(terminalLine);

    terminalInterval = setInterval(() => {
        if (terminalStack.length > 0) {
            const token = terminalStack.shift();
            if (token === '[DONE]') {
                clearInterval(terminalInterval);
            } else {
                terminalLine.textContent += (terminalLine.textContent ? ' ' : '') + token;
                scrollToBottom();
            }
        }
    }, 50);
}

function initializeTerminal() {
    terminal.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const allText = terminal.textContent;
            const inputText = allText.substring(allText.lastIndexOf('>') + 1);
            if (inputText.trim() !== lastInput.trim()) {
                executeCommand(inputText.trim());
                lastInput = inputText;
            }
            appendInputPrefix();
        }
    });
    appendInputPrefix();
}

function appendInputPrefix() {
    const inputLine = document.createElement('div');
    inputLine.classList.add('input-line');
    inputLine.textContent = '>';
    terminal.appendChild(inputLine);
    placeCaretAtEnd(inputLine);
    scrollToBottom();
}

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
}

initializeTerminal();
