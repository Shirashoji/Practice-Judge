import { useState, useEffect, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

// ユーザーが選べる値。autoはOSの設定に従う。
export type ThemeMode = "light" | "dark" | "auto";
// 実際に描画に使う値。autoは解決済みなので現れない。
export type ColorMode = "light" | "dark";

export type ThemeContextValue = {
    colorMode: ColorMode | undefined;
    themeMode: ThemeMode | undefined;
    setColorMode: (mode: ColorMode) => void;
    setThemeMode: (mode: ThemeMode) => void;
};

// 初回描画時はlocalStorageもmatchMediaも読めていないのでundefined。
// 読める前に描くと、保存済みの設定と違うテーマが一瞬出る。
export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useColorMode () {
    return useContext(ThemeContext);
}

export function ColorModeProvider ({ children }: { children: ReactNode }) {
    // themeModeはユーザーの選択、colorModeは実際に描画する解決済みテーマ。
    const [themeMode, _setThemeMode] = useState<ThemeMode | undefined>(undefined);
    const [systemColorMode, setSystemColorMode] = useState<ColorMode | undefined>(undefined);

    const setThemeMode = (mode: ThemeMode) => {
        _setThemeMode(mode);
        window.localStorage.setItem("colormode", mode);
    };

    // 既存コンポーネント向け。明示的なlight/dark選択として扱う。
    const setColorMode = (mode: ColorMode) => setThemeMode(mode);

    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const storageVal = window.localStorage.getItem("colormode");
        window.localStorage.removeItem("llm-colormode");
        if (storageVal == "auto" || storageVal == "light" || storageVal == "dark") {
            _setThemeMode(storageVal);
        }
        else {
            setThemeMode("auto");
        }

        const applySystemMode = (event: MediaQueryList | MediaQueryListEvent) => {
            setSystemColorMode(event.matches ? "dark" : "light");
        };
        applySystemMode(media);
        media.addEventListener("change", applySystemMode);
        return () => media.removeEventListener("change", applySystemMode);
    }, []);

    const colorMode = themeMode === "light" || themeMode === "dark"
        ? themeMode
        : systemColorMode;

    return (
        <ThemeContext value={{ colorMode, themeMode, setColorMode, setThemeMode }}>
            {children}
        </ThemeContext>
    );
}
