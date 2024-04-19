// Help System

const helpMessages = {
    '_'      : 'This is a terminal for the <a href="https://github.com/susiai/susi_chat" target="_blank">SUSI.AI Chat v2.</a>\n\n' +
                'It is a simple terminal emulator with a virtual file system.\n\n' +
                'You can either chat with the AI assistant or use the following commands:\n\n' +
                'help, reset, touch, mv, less, cat, ls, pwd, cd, mkdir, rmdir, tree, set, get, chop\n\n' +
                'Type "help &lt;command&gt;" to get more information about a specific command',
    'help'   : 'help: help [command]\n\nDisplay information about builtin commands.',
    'reset'  : 'reset: reset\n\nReset the terminal messages.',
    'touch'  : 'touch: touch &lt;file&gt;\n\nCreate a file.',
    'mv'     : 'mv: mv &lt;oldname&gt; &lt;newname&gt;\n\nRename a file.',
    'less'   : 'less: less &lt;file&gt;\n\nDisplay the contents of a file.',
    'cat'    : 'cat: cat &lt;file&gt;\n\nCreate a file.',
    'ls'     : 'ls\n\nList directory contents.',
    'pwd'    : 'pwd: pwd\n\nPrint the name of the current working directory.',
    'cd'     : 'cd: cd &lt;path&gt;\n\nChange the current working directory.',
    'mkdir'  : 'mkdir: mkdir &lt;dir&gt;\n\nCreate a directory.',
    'rmdir'  : 'rmdir: rmdir &lt;dir&gt;\n\nRemove a directory.',
    'tree'   : 'tree: tree\n\nDisplay directory tree.',
    'set'    : 'set: set &lt;attribute&gt; &lt;value&gt;\n\nSet an attribute.',
    'get'    : 'get: get &lt;attribute&gt;\n\nGet an attribute.',
    'chop'   : 'chop: chop\n\nRemove the last communication question/answer.',
    'edit'   : 'edit: edit &lt;file&gt;\n\nEdit a file.',
    'default': 'Error: Invalid command'
};

function helpCommand(args) {
    // we consider that args[0] === 'help'
    if (args[1]) {
        command = args[1].toLowerCase();
        return helpMessages[command] || helpMessages['default'];
    } else {
        // Display general help and open link in other tab
        return helpMessages['_'];
    }
}

function help() {
    return helpCommand(['help', '_']);
}
