import { useState, useEffect, createContext, useContext } from 'react';

export const ThemeContext = createContext(undefined);

export function useColorMode () {
    return useContext(ThemeContext);
}

export function ColorModeProvider ({ children }) {
    // themeModeはユーザーの選択、colorModeは実際に描画する解決済みテーマ。
    const [themeMode, _setThemeMode] = useState(undefined);
    const [systemColorMode, setSystemColorMode] = useState(undefined);

    const setThemeMode = (mode) => {
        _setThemeMode(mode);
        window.localStorage.setItem("colormode", mode);
    };

    // 既存コンポーネント向け。明示的なlight/dark選択として扱う。
    const setColorMode = (mode) => setThemeMode(mode);

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

        const applySystemMode = (event) => {
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
