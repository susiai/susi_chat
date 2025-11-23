class UICommands {
    constructor(vfs, terminal) {
        this.vfs = vfs;
        this.terminal = terminal;
    }

    async edit(path) {
        if (!path) return;
        let fileContent = '';
        try {
            fileContent = await this.vfs.get(path);
        } catch (error) {
            this.vfs.touch(path);
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
        this.terminal.appendChild(editor);

        // make a save button to save the edited file
        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        this.terminal.appendChild(saveButton);

        // make another button to cancel the edit and abandon the changes
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        this.terminal.appendChild(cancelButton);

        // event listeners for the save and cancel buttons
        saveButton.addEventListener('click', () => {
            const newContent = editor.value;
            this.vfs.put(path, newContent);
            this.terminal.removeChild(editor);
            this.terminal.removeChild(saveButton);
        });
        cancelButton.addEventListener('click', () => {
            this.terminal.removeChild(editor);
            this.terminal.removeChild(saveButton);
            this.terminal.removeChild(cancelButton);
        });
    }
}
