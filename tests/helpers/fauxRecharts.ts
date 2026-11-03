// tests/helpers/fauxRecharts.ts
//
// Fausse version de `recharts` pour les tests de RENDU qui ne vérifient pas le graphique lui-même :
// jsdom ne mesure rien (largeur 0), et les vrais graphiques n'apportent que du bruit et du temps.
// Les conteneurs rendent leurs enfants dans un <div>, les éléments graphiques ne rendent rien.
//
// Usage (la fabrique de `vi.mock` est remontée en tête de fichier : importer DANS la fabrique) :
//   vi.mock('recharts', async () => (await import('../../helpers/fauxRecharts')).fauxRecharts());
import { createElement, type ReactNode } from 'react';

const Conteneur = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
const Rien = () => null;

export function fauxRecharts(): Record<string, unknown> {
    return {
        ResponsiveContainer: Conteneur, PieChart: Conteneur, BarChart: Conteneur, LineChart: Conteneur,
        AreaChart: Conteneur, ComposedChart: Conteneur,
        Pie: Rien, Bar: Rien, Area: Rien, Line: Rien, Cell: Rien, Legend: Rien, ReferenceLine: Rien,
        XAxis: Rien, YAxis: Rien, Tooltip: Rien, CartesianGrid: Rien,
    };
}
