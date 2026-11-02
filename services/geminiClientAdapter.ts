// services/geminiClientAdapter.ts
//
// Adaptateur léger sans dépendance externe permettant d'appeler l'API Google Gemini (`v1beta`)
// avec l'interface de messages structurés utilisée par `services/gemini.ts`.
// Sécurité : la clé API est transmise exclusivement via l'en-tête HTTP `x-goog-api-key`
// (jamais en paramètre d'URL `?key=`).
// No-fake-data : `usage` reflète uniquement `usageMetadata` réel renvoyé par l'API (jamais de
// nombres de jetons inventés).

import type { GenerateContentResponse } from '@google/genai';
import { MODEL_IDS } from './aiChat/models';

type _GeminiOfficialResponse = GenerateContentResponse;

export interface GeminiImageBlockParam {
    type: 'image';
    source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
    };
}

export interface GeminiDocumentBlockParam {
    type: 'document';
    source:
        | {
              type: 'base64';
              media_type: 'application/pdf';
              data: string;
          }
        | {
              type: 'text';
              media_type: 'text/plain';
              data: string;
          };
    title?: string;
}

interface GeminiTextBlockParam {
    type: 'text';
    text: string;
}

export type GeminiContentBlockParam =
    | GeminiImageBlockParam
    | GeminiDocumentBlockParam
    | GeminiTextBlockParam
    | {
          type: 'tool_use';
          id: string;
          name: string;
          input: Record<string, unknown>;
      }
    | {
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
      };

export interface GeminiCompatibleClient {
    maxRetries: number;
    messages: {
        create: (
            params: ParamsRequeteGemini,
            options?: { signal?: AbortSignal },
        ) => Promise<{
            id: string;
            type: 'message';
            role: 'assistant';
            model: string;
            content: ResultatAppelGemini['contentBlocks'];
            stop_reason: ResultatAppelGemini['stopReason'];
            usage: ResultatAppelGemini['usage'];
        }>;
        stream: (
            params: ParamsRequeteGemini,
            options?: { signal?: AbortSignal },
        ) => AsyncGenerator<{
            type: 'content_block_delta';
            delta: { type: 'text_delta'; text: string };
        }> & {
            finalMessage: () => Promise<{
                model: string;
                usage: ResultatAppelGemini['usage'];
            }>;
        };
    };
}

const GEMINI_DEFAULT_MODEL = MODEL_IDS.sonnet; // 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MAX_RETRIES = 2;

/** Résout un identifiant de modèle (ou alias historique) vers un modèle officiel Google Gemini 2.5. */
function resoudreModeleGemini(model: string | undefined): string {
    if (!model) return GEMINI_DEFAULT_MODEL;
    if (model === 'gemini-2.5-flash-lite' || model === 'claude-haiku-5-5' || model === 'haiku') {
        return MODEL_IDS.haiku;
    }
    if (model === 'gemini-2.5-flash' || model === 'claude-sonnet-5-5' || model === 'sonnet' || model === 'gemini-3.8-flash') {
        return MODEL_IDS.sonnet;
    }
    if (model === 'gemini-2.5-pro' || model === 'claude-opus-5-5' || model === 'opus') {
        return MODEL_IDS.opus;
    }
    if (model.startsWith('gemini-')) return model;
    return GEMINI_DEFAULT_MODEL;
}

interface GeminiPart {
    text?: string;
    inlineData?: { mimeType: string; data: string };
    functionCall?: { name: string; args: Record<string, unknown> };
    functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiResponsePayload {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
                functionCall?: { name: string; args?: Record<string, unknown> };
            }>;
        };
        finishReason?: string;
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
    };
    // Tolérance pour les réponses simulées dans certains tests unitaires :
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
    error?: {
        code?: number;
        message?: string;
        status?: string;
    };
}

function extraireSystemTexte(system: unknown): string | undefined {
    if (typeof system === 'string' && system.trim()) return system;
    if (Array.isArray(system)) {
        const txt = system
            .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: unknown }).text ?? '') : ''))
            .filter(Boolean)
            .join('\n');
        return txt || undefined;
    }
    return undefined;
}

function convertirMessagesPourGemini(messages: unknown[]): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> {
    return messages.map((msg) => {
        const m = msg as { role?: string; content?: unknown };
        const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
        if (typeof m.content === 'string') {
            return { role, parts: [{ text: m.content }] };
        }
        if (Array.isArray(m.content)) {
            const parts: GeminiPart[] = [];
            for (const rawBlock of m.content) {
                const block = rawBlock as {
                    type?: string;
                    text?: string;
                    title?: string;
                    name?: string;
                    input?: Record<string, unknown>;
                    tool_use_id?: string;
                    content?: unknown;
                    source?: { type?: string; media_type?: string; data?: string };
                };
                if (block.type === 'text' && typeof block.text === 'string') {
                    parts.push({ text: block.text });
                } else if ((block.type === 'image' || block.type === 'document') && block.source?.type === 'text' && typeof block.source.data === 'string') {
                    const prefix = block.title ? `[${block.title}]\n` : '';
                    parts.push({ text: `${prefix}${block.source.data}` });
                } else if ((block.type === 'image' || block.type === 'document') && block.source?.data) {
                    parts.push({
                        inlineData: {
                            mimeType: block.source.media_type || 'application/pdf',
                            data: block.source.data,
                        },
                    });
                } else if (block.type === 'tool_use' && block.name) {
                    parts.push({
                        functionCall: {
                            name: block.name,
                            args: block.input ?? {},
                        },
                    });
                } else if (block.type === 'tool_result') {
                    parts.push({
                        functionResponse: {
                            name: block.tool_use_id || 'tool',
                            response: {
                                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
                            },
                        },
                    });
                }
            }
            return { role, parts: parts.length > 0 ? parts : [{ text: '' }] };
        }
        return { role, parts: [{ text: String(m.content ?? '') }] };
    });
}

function convertirOutilsPourGemini(tools: unknown[] | undefined): Array<{ functionDeclarations: unknown[] }> | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    const declarations = tools
        .map((t) => {
            if (!t || typeof t !== 'object') return null;
            const tool = t as { name?: string; description?: string; input_schema?: unknown };
            if (!tool.name) return null;
            return {
                name: tool.name,
                description: tool.description ?? '',
                ...(tool.input_schema ? { parameters: tool.input_schema } : {}),
            };
        })
        .filter(Boolean);
    return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;
}

function mapperStopReason(finishReason: string | undefined, fallbackStopReason: string | undefined): 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use' {
    if (fallbackStopReason === 'max_tokens' || finishReason === 'MAX_TOKENS') return 'max_tokens';
    if (
        fallbackStopReason === 'refusal'
        || finishReason === 'SAFETY'
        || finishReason === 'RECITATION'
        || finishReason === 'BLOCKLIST'
        || finishReason === 'PROHIBITED_CONTENT'
        || finishReason === 'SPII'
    ) {
        return 'refusal';
    }
    if (fallbackStopReason === 'tool_use') return 'tool_use';
    return 'end_turn';
}

function estStatutReessayable(status: number): boolean {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

function delaiRetryMs(res: Response | null, attempt: number): number {
    const header = res?.headers?.get?.('retry-after');
    if (header !== null && header !== undefined && header !== '') {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.round(seconds * 1000);
        }
    }
    return Math.min(500 * Math.pow(2, attempt), 8000);
}

function attendreDelai(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

interface ParamsRequeteGemini {
    system?: unknown;
    messages?: unknown[];
    max_tokens?: number;
    model?: string;
    thinking?: { type?: string };
    output_config?: { effort?: string };
    tools?: unknown[];
}

interface ResultatAppelGemini {
    text: string;
    contentBlocks: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use';
    usage:
        | {
              input_tokens: number;
              output_tokens: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
          }
        | undefined;
    resolvedModel: string;
}

async function appelerGeminiRest(
    apiKey: string,
    params: ParamsRequeteGemini,
    signal?: AbortSignal,
    maxRetries = DEFAULT_MAX_RETRIES,
): Promise<ResultatAppelGemini> {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const cleanKey = apiKey.trim();
    const resolvedModel = resoudreModeleGemini(params.model);
    const url = `${GEMINI_API_BASE}/${resolvedModel}:generateContent`;
    const systemText = extraireSystemTexte(params.system);
    const contents = convertirMessagesPourGemini(params.messages ?? []);
    const geminiTools = convertirOutilsPourGemini(params.tools);

    const generationConfig: Record<string, unknown> = {
        maxOutputTokens: params.max_tokens ?? 4096,
    };
    if (params.thinking?.type === 'disabled') {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
        model: resolvedModel,
        contents,
        generationConfig,
        max_tokens: params.max_tokens ?? 4096,
    };
    if (params.thinking !== undefined) {
        body.thinking = params.thinking;
    }
    if (params.output_config !== undefined) {
        body.output_config = params.output_config;
    }
    if (systemText) {
        body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (geminiTools) {
        body.tools = geminiTools;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
            throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': cleanKey,
                },
                body: JSON.stringify(body),
                signal,
            });
        } catch (err) {
            lastError = err;
            if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
                throw err;
            }
            if (attempt < maxRetries) {
                await attendreDelai(delaiRetryMs(null, attempt), signal);
                continue;
            }
            throw err;
        }

        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
                const errJson = (await res.json()) as GeminiResponsePayload;
                if (errJson?.error?.message) detail = errJson.error.message;
            } catch {
                // ignore JSON parse error on error body
            }
            const httpErr = Object.assign(new Error(detail), { status: res.status });
            if (attempt < maxRetries && estStatutReessayable(res.status)) {
                await attendreDelai(delaiRetryMs(res, attempt), signal);
                continue;
            }
            throw httpErr;
        }

        const data = (await res.json()) as GeminiResponsePayload;
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts;

        const contentBlocks: ResultatAppelGemini['contentBlocks'] = [];
        const textParts: string[] = [];

        if (Array.isArray(parts) && parts.length > 0) {
            let toolIdx = 0;
            for (const p of parts) {
                if (typeof p.text === 'string') {
                    textParts.push(p.text);
                    contentBlocks.push({ type: 'text', text: p.text });
                } else if (p.functionCall?.name) {
                    toolIdx += 1;
                    contentBlocks.push({
                        type: 'tool_use',
                        id: `gemini_tool_${Date.now()}_${toolIdx}`,
                        name: p.functionCall.name,
                        input: p.functionCall.args ?? {},
                    });
                }
            }
        } else if (Array.isArray(data.content)) {
            for (const c of data.content) {
                if (c?.type === 'text' && typeof c.text === 'string') {
                    textParts.push(c.text);
                    contentBlocks.push({ type: 'text', text: c.text });
                }
            }
        }

        const text = textParts.join('');
        if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'text', text: '' });
        }

        const hasToolUse = contentBlocks.some((b) => b.type === 'tool_use');
        const stopReason = hasToolUse
            ? 'tool_use'
            : mapperStopReason(candidate?.finishReason, data.stop_reason);

        // No-fake-data : jamais de jetons inventés (120/180) si la réponse ne porte pas d'usage réel.
        let usage: ResultatAppelGemini['usage'];
        if (
            data.usageMetadata
            && (typeof data.usageMetadata.promptTokenCount === 'number'
                || typeof data.usageMetadata.candidatesTokenCount === 'number')
        ) {
            usage = {
                input_tokens: data.usageMetadata.promptTokenCount ?? 0,
                output_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
                ...(typeof data.usageMetadata.cachedContentTokenCount === 'number'
                    ? { cache_read_input_tokens: data.usageMetadata.cachedContentTokenCount }
                    : {}),
            };
        } else if (
            data.usage
            && (typeof data.usage.input_tokens === 'number' || typeof data.usage.output_tokens === 'number')
        ) {
            usage = {
                input_tokens: data.usage.input_tokens ?? 0,
                output_tokens: data.usage.output_tokens ?? 0,
                ...(typeof data.usage.cache_read_input_tokens === 'number'
                    ? { cache_read_input_tokens: data.usage.cache_read_input_tokens }
                    : {}),
                ...(typeof data.usage.cache_creation_input_tokens === 'number'
                    ? { cache_creation_input_tokens: data.usage.cache_creation_input_tokens }
                    : {}),
            };
        }

        return {
            text,
            contentBlocks,
            stopReason,
            usage,
            resolvedModel,
        };
    }

    throw lastError ?? new Error('Appel Google Gemini échoué');
}

/**
 * Crée un client compatible avec l'interface attendue par `services/gemini.ts`
 * qui route tous les appels directement vers l'API Google Gemini (`v1beta`).
 */
export function creerClientCompatibleGemini(apiKey: string): GeminiCompatibleClient {
    const maxRetries = DEFAULT_MAX_RETRIES;

    const createFn = async (
        params: ParamsRequeteGemini,
        options?: { signal?: AbortSignal },
    ) => {
        const out = await appelerGeminiRest(apiKey, params, options?.signal, maxRetries);
        return {
            id: `gemini_${Date.now()}`,
            type: 'message' as const,
            role: 'assistant' as const,
            model: out.resolvedModel,
            content: out.contentBlocks,
            stop_reason: out.stopReason,
            usage: out.usage,
        };
    };

    const streamFn = (
        params: ParamsRequeteGemini,
        options?: { signal?: AbortSignal },
    ) => {
        let finalUsage: ResultatAppelGemini['usage'];
        let finalModel = resoudreModeleGemini(params.model);
        const promesse = appelerGeminiRest(apiKey, params, options?.signal, maxRetries).then((res) => {
            finalUsage = res.usage;
            finalModel = res.resolvedModel;
            return res;
        });

        async function* generateur() {
            const res = await promesse;
            const morceaux = res.text.match(/.{1,48}(\s|$)|.+/gs) ?? (res.text ? [res.text] : []);
            for (const m of morceaux) {
                yield {
                    type: 'content_block_delta' as const,
                    delta: { type: 'text_delta' as const, text: m },
                };
            }
        }

        const iter = generateur();
        return Object.assign(iter, {
            finalMessage: async () => {
                await promesse;
                return { model: finalModel, usage: finalUsage };
            },
        });
    };

    return {
        maxRetries,
        messages: {
            create: createFn,
            stream: streamFn,
        },
    };
}
