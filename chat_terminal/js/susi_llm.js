// createSusiLLM is a single-file client for chat history + HTTP calls.
// Usage:
//   const llm = createSusiLLM({ systemPrompt });
//   llm.history.addUser("Hello");
//   await llm.streamChat({ baseUrl, apiKey, model, stopTokens, onToken: (t) => console.log(t) });
function createSusiLLM(options = {}) {
    const defaultSystemPrompt = options.systemPrompt || '';

    // In-memory chat history. Intended to be the only state store for prompts.
    class SusiChatHistory {
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

    const history = new SusiChatHistory(defaultSystemPrompt);

    // Build /v1/chat/completions payload from history + overrides.
    const buildChatPayload = (options = {}) => {
        const model = options.model;
        const messages = options.messages || history.getMessages();
        if (!model) {
            throw new Error('Missing model');
        }
        const payload = {
            model: model,
            messages: messages,
            stream: options.stream !== false
        };
        const maxTokens = options.maxTokens;
        const temperature = options.temperature;
        const stopTokens = Array.isArray(options.stopTokens) ? options.stopTokens : null;
        if (model && (model.startsWith('o4') || model.startsWith('gpt-4.1'))) {
            if (typeof maxTokens === 'number') payload.max_completion_tokens = maxTokens;
        } else {
            if (typeof maxTokens === 'number') payload.max_tokens = maxTokens;
            if (typeof temperature === 'number') payload.temperature = temperature;
            if (stopTokens && stopTokens.length) payload.stop = stopTokens;
        }
        return payload;
    };

    const buildHeaders = (apiKey) => {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey !== '' && apiKey !== '_') {
            headers.Authorization = 'Bearer ' + apiKey;
        }
        return headers;
    };

    // Streaming chat-completions: passes tokens to onToken and signals onDone.
    const streamChat = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const payload = buildChatPayload(options);
        const response = await fetch(baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(payload),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        if (!response.body) {
            throw new Error('Error: Missing response body');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let tokenCount = 0;
        let startedAt = performance.now();
        let firstTokenAt = 0;
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            const lines = decoder.decode(result.value).split('\n');
            for (let line of lines) {
                line = line.replace(/^data: /, '').trim();
                if (!line) continue;
                if (line === '[DONE]') continue;
                if (line.startsWith('error')) {
                    if (typeof options.onError === 'function') options.onError(line);
                    continue;
                }
                try {
                    const json = JSON.parse(line);
                    const delta = json.choices && json.choices[0] && json.choices[0].delta;
                    if (delta && delta.content) {
                        if (firstTokenAt === 0) firstTokenAt = performance.now();
                        tokenCount += 1;
                        if (typeof options.onToken === 'function') options.onToken(delta.content);
                    }
                } catch (error) {
                    if (typeof options.onError === 'function') {
                        options.onError('Error parsing JSON: ' + error.message);
                    }
                }
            }
        }
        if (typeof options.onDone === 'function') {
            options.onDone({ tokenCount, startedAt, firstTokenAt, endedAt: performance.now() });
        }
        return { tokenCount, startedAt, firstTokenAt, endedAt: performance.now() };
    };

    // Non-streaming chat-completions, returns the full JSON response.
    const completeChat = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const payload = buildChatPayload({ ...options, stream: false });
        const response = await fetch(baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(payload),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // Lightweight model warmup; returns answer + token usage.
    const warmup = async (options = {}) => {
        const systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : defaultSystemPrompt;
        const messages = [{ role: 'system', content: systemPrompt }];
        const data = await completeChat({
            ...options,
            messages
        });
        const answer = data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : '';
        const usage = data.usage || {};
        return {
            answer,
            completion_tokens: usage.completion_tokens || 0,
            prompt_tokens: usage.prompt_tokens || 0,
            total_tokens: usage.total_tokens || 0
        };
    };

    // llama.cpp-specific model loader (POST /models/load).
    const llamaCppLoadModel = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/models/load', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ model: options.model }),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // OpenAI-compatible model list (GET /v1/models).
    const listModels = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/v1/models', {
            method: 'GET',
            headers: buildHeaders(apiKey),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // Ollama pull with llama.cpp load as failover.
    const ollamaPull = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        try {
            const response = await fetch(baseUrl + '/api/pull', {
                method: 'POST',
                headers: buildHeaders(apiKey),
                body: JSON.stringify({ model: options.model }),
                signal: options.signal
            });
            if (!response.ok) {
                throw new Error(`Error: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            return await llamaCppLoadModel(options);
        }
    };

    // Ollama delete endpoint (POST /api/delete).
    const ollamaDelete = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/api/delete', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ model: options.model }),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // Public API surface (single object for easy embedding).
    return {
        history,
        buildChatPayload,
        streamChat,
        completeChat,
        warmup,
        listModels,
        llamaCppLoadModel,
        ollamaPull,
        ollamaDelete
    };
}
