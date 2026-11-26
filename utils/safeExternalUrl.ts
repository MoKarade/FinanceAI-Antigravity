// utils/safeExternalUrl.ts
// Validation stricte des liens externes affichés ou relayés (`http://` ou `https://` uniquement).

/**
 * Valide qu'une URL externe utilise strictement `http:` ou `https:` sans identifiants embarqués.
 * Retourne `undefined` pour tout schéma dangereux (`javascript:`, `data:`, `file:`, etc.) ou URL invalide.
 */
export function safeExternalHttpUrl(rawUrl: unknown): string | undefined {
    if (typeof rawUrl !== 'string') return undefined;
    const trimmed = rawUrl.trim();
    if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return undefined;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return undefined;
        }
        if (parsed.username || parsed.password) {
            return undefined;
        }
        return parsed.href;
    } catch {
        return undefined;
    }
}
