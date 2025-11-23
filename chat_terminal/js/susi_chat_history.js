class ChatHistory {
    constructor(systemPrompt) {
        this.systemPrompt = systemPrompt;
        this.messages = [{ role: 'system', content: systemPrompt }];
    }

    reset(systemPrompt = this.systemPrompt) {
        this.systemPrompt = systemPrompt;
        this.messages = [{ role: 'system', content: systemPrompt }];
    }

    setSystemPrompt(systemPrompt) {
        this.systemPrompt = systemPrompt;
        if (this.messages.length > 0) {
            this.messages[0] = { role: 'system', content: systemPrompt };
        } else {
            this.messages = [{ role: 'system', content: systemPrompt }];
        }
    }

    addMessage(message) {
        this.messages.push(message);
    }

    addUser(content) {
        this.messages.push({ role: 'user', content });
    }

    addAssistant(content) {
        this.messages.push({ role: 'assistant', content });
    }

    getMessages() {
        return this.messages;
    }

    setMessages(messages) {
        this.messages = messages;
    }

    length() {
        return this.messages.length;
    }

    last() {
        return this.messages[this.messages.length - 1];
    }

    getLastContent() {
        const last = this.last();
        return last ? last.content : '';
    }

    getLastAssistantContent() {
        for (let i = this.messages.length - 1; i >= 0; i -= 1) {
            if (this.messages[i].role === 'assistant') return this.messages[i].content;
        }
        return '';
    }

    getSecondLastContent() {
        return this.messages.length >= 2 ? this.messages[this.messages.length - 2].content : '';
    }

    chopLastPair() {
        const before = this.messages.length;
        if (this.messages.length > 1) {
            this.messages.pop();
            this.messages.pop();
        }
        return { before, after: this.messages.length };
    }

    truncateLastPair() {
        if (this.messages.length >= 2) {
            this.messages = this.messages.slice(0, -2);
        }
    }

    appendUserEmptyAndAssistant(content) {
        this.messages.push({ role: 'user', content: '' });
        this.messages.push({ role: 'assistant', content });
    }

    buildEmptyPromptState() {
        const transposed = [];
        let promptContent = '';
        if (this.messages.length > 0) {
            transposed.push({ ...this.messages[0] });
        }
        for (let i = 2; i < this.messages.length - 2; i += 2) {
            const assistantm = { ...this.messages[i], role: 'user' };
            const userm = { ...this.messages[i + 1], role: 'assistant' };
            transposed.push(assistantm);
            transposed.push(userm);
            promptContent = assistantm.content;
        }
        return { transposed, promptContent };
    }
}
