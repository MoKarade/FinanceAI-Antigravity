// tests/services/import/disnat/lignesDuPdf.test.ts
//
// [PTF-L1F2-LECTURE-PDF] Relevé PDF → lignes. La preuve qui compte TRAVERSE : le relevé FICTIF de
// `fixtureReleve.ts` est imprimé dans un vrai PDF 1.4 (générateur pur JS sans jspdf), relu par
// pdfjs, puis lu par `lireReleveDisnat` — et le résultat doit être celui du texte d'origine.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { reconstruireLignes, lireLignesPdf, type PdfjsMinimal } from '../../../../services/import/disnat/lignesDuPdf';
import { lireReleveDisnat } from '../../../../services/import/disnat/lireReleveDisnat';
import { LIGNES } from './fixtureReleve';

/** pdfjs version Node : le worker est chargé par pdfjs lui-même (« faux worker »), pas par Vite. */
const pdfjsNode = async (): Promise<PdfjsMinimal> => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsMinimal;

const WIN_ANSI_EXTRA: Readonly<Record<number, number>> = {
    0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97,
};

function encoderChainePdf(texte: string): string {
    let out = '';
    for (let i = 0; i < texte.length; i++) {
        const cp = texte.charCodeAt(i);
        const b = WIN_ANSI_EXTRA[cp] ?? (cp <= 0xff ? cp : 0x3f);
        if (b === 0x5c || b === 0x28 || b === 0x29) out += '\\' + String.fromCharCode(b);
        else if (b < 0x20 || b >= 0x7f) out += '\\' + b.toString(8).padStart(3, '0');
        else out += String.fromCharCode(b);
    }
    return out;
}

/** Imprime des lignes dans un mini-PDF 1.4 pur JS, 40 par page, à la façon d'un relevé (pas de 14 points). */
function pdfDe(lignes: readonly string[]): Uint8Array {
    const pages: string[][] = [];
    for (let i = 0; i < lignes.length; i += 40) pages.push(lignes.slice(i, i + 40));
    if (pages.length === 0) pages.push([]);

    const objets: string[] = [];
    const pageIds = pages.map((_, p) => 4 + p * 2);
    objets.push('<< /Type /Catalog /Pages 2 0 R >>');
    objets.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    objets.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

    for (const pageLignes of pages) {
        const streamId = objets.length + 2;
        const contenu = [
            'BT',
            '/F1 9 Tf',
            ...pageLignes.map((l, idx) => `1 0 0 1 36 ${752 - idx * 14} Tm (${encoderChainePdf(l)}) Tj`),
            'ET',
        ].join('\n');
        const longueur = Buffer.byteLength(contenu, 'ascii');
        objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
        objets.push(`<< /Length ${longueur} >>\nstream\n${contenu}\nendstream`);
    }

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let i = 0; i < objets.length; i++) {
        offsets.push(Buffer.byteLength(pdf, 'ascii'));
        pdf += `${i + 1} 0 obj\n${objets[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'ascii');
    pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objets.length; i++) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(pdf, 'ascii'));
}

describe('[PTF-L1F2] reconstruction des lignes (pure)', () => {
    it('regroupe à la tolérance verticale, ordonne de haut en bas puis de gauche à droite', () => {
        expect(reconstruireLignes([
            { texte: 'B', x: 60, y: 700.4, largeur: 10 },
            { texte: 'bas', x: 10, y: 600, largeur: 20 },
            { texte: 'A', x: 10, y: 701.9, largeur: 10 },
        ])).toEqual(['A B', 'bas']);
    });

    it('deux fragments COLLÉS ne reçoivent pas d\'espace, deux fragments espacés en reçoivent une', () => {
        expect(reconstruireLignes([
            { texte: '1 011', x: 10, y: 500, largeur: 20 },
            { texte: ',2657', x: 30, y: 500, largeur: 20 },
            { texte: 'C', x: 80, y: 500, largeur: 5 },
        ])).toEqual(['1 011,2657 C']);
    });

    it('à 3 points d\'écart vertical, ce sont DEUX lignes (la tolérance est stricte)', () => {
        expect(reconstruireLignes([
            { texte: '2', x: 10, y: 503, largeur: 5 },
            { texte: 'TITRE', x: 10, y: 500, largeur: 30 },
        ])).toEqual(['2', 'TITRE']);
    });

    it('fragments vides et coordonnées non finies ignorés', () => {
        expect(reconstruireLignes([
            { texte: '', x: 1, y: 1, largeur: 0 },
            { texte: 'X', x: Number.NaN, y: 1, largeur: 1 },
        ])).toEqual([]);
    });
});

describe('[PTF-L1F2] traversée : PDF réel → pdfjs → lignes → relevé', () => {
    it('le relevé fictif imprimé en PDF se relit ligne pour ligne', async () => {
        const lignes = await lireLignesPdf(pdfDe(LIGNES), pdfjsNode);
        const attendu = LIGNES.map((l) => l.replace(/[’]/g, '\'').replace(/\s+/g, ' ').trim());
        const lues = lignes.map((l) => l.replace(/[’]/g, '\''));
        expect(lues).toEqual(attendu);
    }, 30_000);

    it('et le relevé lu depuis le PDF est celui lu depuis le texte', async () => {
        const lignes = await lireLignesPdf(pdfDe(LIGNES), pdfjsNode);
        const depuisPdf = lireReleveDisnat(lignes);
        expect(depuisPdf.anomalies).toEqual([]);
        expect(depuisPdf).toEqual(lireReleveDisnat(LIGNES));
    }, 30_000);
});
