export type NameTheme = 'default' | 'dark' | 'white';
export type AccentKey = 'default' | 'rose' | 'rouge' | 'orange' | 'or' | 'jaune' | 'vert' | 'menthe' | 'bleu_fonce' | 'bleu_clair' | 'cyan' | 'violet' | 'lavande' | 'marron' | 'anthracite' | 'argent' | 'corail' | 'turquoise' | 'indigo' | 'fuchsia' | 'emeraude' | 'peche' | 'pride';
export declare const NAME_BG: Record<NameTheme, string>;
export declare const ACCENTS: {
    key: AccentKey;
    label: string;
    gradient: string;
}[];
export declare const ACCENTS_MAP: Record<AccentKey, string>;
//# sourceMappingURL=palette.d.ts.map