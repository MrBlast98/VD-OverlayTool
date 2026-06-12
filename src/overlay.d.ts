declare global {
    interface Window {
        api: {
            timer: {
                get: () => Promise<any>;
                set: (data: any) => void;
                onSync: (callback: (data: any) => void) => () => void;
            };
            overlay: {
                onSettings: (callback: (settings: any) => void) => () => void;
                measure: (width: number, height: number) => void;
            };
            hotkeys: {
                on: (callback: (payload: any) => void) => () => void;
            };
        };
    }
}
export {};
//# sourceMappingURL=overlay.d.ts.map