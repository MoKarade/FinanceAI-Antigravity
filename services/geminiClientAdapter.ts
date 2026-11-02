// services/geminiClientAdapter.ts
//
// Adaptateur léger sans dépendance externe permettant d'utiliser une clé Google Gemini (`AIza...`)
// directement avec l'interface client de `services/claude.ts` (`gemini-3.8-flash`).

import type Anthropic from '@anthropic-ai/sdk';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function estCleGemini(apiKey: string | undefined | null): boolean {
    if (!apiKey) return false;
    return apiKey.trim().startsWith('AIza');
}

interface GeminiPart {
    text?: string;
    inlineData?: { mimeType: string; data: string };
}

interface GeminiResponsePayload {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
    };
    error?: {
        code?: number;
        message?: string;
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
                    source?: { type?: string; media_type?: string; data?: string };
                };
                if (block.type === 'text' && typeof block.text === 'string') {
                    parts.push({ text: block.text });
                } else if ((block.type === 'image' || block.type === 'document') && block.source?.data) {
                    parts.push({
                        inlineData: {
                            mimeType: block.source.media_type || 'application/pdf',
                            data: block.source.data,
                        },
                    });
                }
            }
            return { role, parts: parts.length > 0 ? parts : [{ text: '' }] };
        }
        return { role, parts: [{ text: String(m.content ?? '') }] };
    });
}

async function appelerGeminiRest(
    apiKey: string,
    params: {
        system?: unknown;
        messages?: unknown[];
        max_tokens?: number;
    },
    signal?: AbortSignal,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const url = `${GEMINI_API_BASE}/${GEMINI_DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
    const systemText = extraireSystemTexte(params.system);
    const contents = convertirMessagesPourGemini(params.messages ?? []);

    const body: Record<string, unknown> = {
        contents,
        generationConfig: {
            maxOutputTokens: params.max_tokens ?? 4096,
            temperature: 0.35,
        },
    };
    if (systemText) {
        body.systemInstruction = { parts: [{ text: systemText }] };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const errJson = (await res.json()) as GeminiResponsePayload;
            if (errJson?.error?.message) detail = errJson.error.message;
        } catch {
            // ignore JSON parse error on error body
        }
        throw Object.assign(new Error(detail), { status: res.status });
    }

    const data = (await res.json()) as GeminiResponsePayload;
    const text =
        data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? '')
            .join('') ?? '';

    return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 120,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 180,
    };
}

/**
 * Crée un client compatible avec l'interface attendue par `services/claude.ts`
 * qui route tous les appels vers Google Gemini (`gemini-3.8-flash`).
 */
export function creerClientCompatibleGemini(apiKey: string): Anthropic {
    const createFn = async (
        params: { system?: unknown; messages?: unknown[]; max_tokens?: number; model?: string },
        options?: { signal?: AbortSignal },
    ) => {
        const out = await appelerGeminiRest(apiKey, params, options?.signal);
        return {
            id: `gemini_${Date.now()}`,
            type: 'message' as const,
            role: 'assistant' as const,
            model: params.model ?? GEMINI_DEFAULT_MODEL,
            content: [{ type: 'text' as const, text: out.text }],
            stop_reason: 'end_turn' as const,
            usage: {
                input_tokens: out.inputTokens,
                output_tokens: out.outputTokens,
            },
        };
    };

    const streamFn = (
        params: { system?: unknown; messages?: unknown[]; max_tokens?: number; model?: string },
        options?: { signal?: AbortSignal },
    ) => {
        let finalUsage = { input_tokens: 0, output_tokens: 0 };
        const promesse = appelerGeminiRest(apiKey, params, options?.signal).then((res) => {
            finalUsage = { input_tokens: res.inputTokens, output_tokens: res.outputTokens };
            return res;
        });

        async function* generateur() {
            const res = await promesse;
            const morceaux = res.text.match(/.{1,48}(\s|$)|.+/gs) ?? [res.text];
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
                return { usage: finalUsage };
            },
        });
    };

    return {
        messages: {
            create: createFn,
            stream: streamFn,
        },
    } as unknown as Anthropic;
}
