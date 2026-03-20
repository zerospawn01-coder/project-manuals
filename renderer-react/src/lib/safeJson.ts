export const safeJson = {
    parse: <T>(str: string, fallback: T): T => {
        try {
            return JSON.parse(str) as T;
        } catch (e) {
            console.error('[SafeJSON] Parse failure:', e);
            return fallback;
        }
    },
    stringify: (obj: Record<string, unknown>): string => {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            console.error('[SafeJSON] Stringify failure:', e);
            return '{}';
        }
    }
};
