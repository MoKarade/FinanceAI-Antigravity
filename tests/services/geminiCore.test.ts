import { describe, it, expect } from 'vitest';
import {
    GEMINI_FALLBACK_CASCADE,
    buildGeminiModelCandidates,
    cleanGeminiApiKey,
    isAbortError,
    isGeminiAuthError,
    isGeminiAuthHttpError,
} from '../../services/aiChat/geminiCore';
import { MODEL_IDS } from '../../services/aiChat/models';

describe('geminiCore — socle unifié Google Gemini', () => {
    it('nettoie guillemets et espaces autour de la clé API', () => {
        expect(cleanGeminiApiKey('  "AIzaSyTestKey_123"  ')).toBe('AIzaSyTestKey_123');
        expect(cleanGeminiApiKey(" 'AIzaKey' ")).toBe('AIzaKey');
        expect(cleanGeminiApiKey('   ')).toBe('');
    });

    it('construit la cascade sans doublon avec le modèle primaire en tête', () => {
        expect(GEMINI_FALLBACK_CASCADE[0]).toBe(MODEL_IDS.sonnet);
        expect(GEMINI_FALLBACK_CASCADE[1]).toBe(MODEL_IDS.haiku);

        const withOpus = buildGeminiModelCandidates(MODEL_IDS.opus);
        expect(withOpus[0]).toBe(MODEL_IDS.opus);
        expect(new Set(withOpus).size).toBe(withOpus.length);
        expect(withOpus).toContain(MODEL_IDS.sonnet);
        expect(withOpus).toContain('gemini-2.5-flash');

        const withSonnet = buildGeminiModelCandidates(MODEL_IDS.sonnet);
        expect(withSonnet[0]).toBe(MODEL_IDS.sonnet);
        expect(withSonnet.filter((m) => m === MODEL_IDS.sonnet)).toHaveLength(1);
    });

    it('détecte les erreurs HTTP et SDK de clé invalide / refusée', () => {
        expect(isGeminiAuthHttpError(401, 'Unauthorized')).toBe(true);
        expect(isGeminiAuthHttpError(403, 'Forbidden')).toBe(true);
        expect(isGeminiAuthHttpError(400, 'API_KEY_INVALID: bad key')).toBe(true);
        expect(isGeminiAuthHttpError(400, 'models/foo not found')).toBe(false);
        expect(isGeminiAuthHttpError(429, 'Quota exceeded')).toBe(false);

        expect(isGeminiAuthError({ status: 401, message: 'denied' })).toBe(true);
        expect(isGeminiAuthError({ status: 400, message: 'API key not valid' })).toBe(true);
        expect(isGeminiAuthError(new Error('PERMISSION_DENIED by API'))).toBe(true);
        expect(isGeminiAuthError(new Error('Network timeout'))).toBe(false);
    });

    it('identifie proprement une annulation AbortError', () => {
        expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        expect(isAbortError(err)).toBe(true);
        expect(isAbortError(new Error('Bad Gateway'))).toBe(false);
    });
});
