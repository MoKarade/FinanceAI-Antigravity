import { describe, expect, it } from 'vitest';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';

describe('safeExternalHttpUrl', () => {
    it('accepte uniquement les URL http:// et https:// sans identifiants embarqués', () => {
        expect(safeExternalHttpUrl('https://finance.yahoo.com/news/test')).toBe(
            'https://finance.yahoo.com/news/test',
        );
        expect(safeExternalHttpUrl('http://example.com/a')).toBe('http://example.com/a');
        expect(safeExternalHttpUrl('  https://www.sec.gov/edgar  ')).toBe('https://www.sec.gov/edgar');
    });

    it('rejette javascript:, data:, file:, identifiants URL et valeurs invalides', () => {
        expect(safeExternalHttpUrl('javascript:alert(1)')).toBeUndefined();
        expect(safeExternalHttpUrl('DATA:text/html,<script>')).toBeUndefined();
        expect(safeExternalHttpUrl('vbscript:msgbox(1)')).toBeUndefined();
        expect(safeExternalHttpUrl('file:///etc/passwd')).toBeUndefined();
        expect(safeExternalHttpUrl('https://user:pass@example.com/')).toBeUndefined();
        expect(safeExternalHttpUrl('/relative/path')).toBeUndefined();
        expect(safeExternalHttpUrl('')).toBeUndefined();
        expect(safeExternalHttpUrl(null)).toBeUndefined();
    });
});
