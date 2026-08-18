import { useState, useEffect, createContext, useContext } from 'react';

export const ThemeContext = createContext(undefined);

export function useColorMode () {
    return useContext(ThemeContext);
}

export function ColorModeProvider ({ children }) {
    // 初回はシステム設定に従い、ボタンで切り替えた後は明示的な選択を保存する。
    // 旧キーは「未選択でもlightを書き込む」仕様だったため、明示設定とは区別する。

    const [colorMode, _setColorMode] = useState(undefined);

    const setColorMode = (mode) => {
        _setColorMode(mode);
        window.localStorage.setItem("colormode-override", mode);
    };

    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const storageVal = window.localStorage.getItem("colormode-override");

        // 自動的にlightが保存されていた旧設定は移行時に破棄する。
        window.localStorage.removeItem("colormode");

        if (storageVal == "light" || storageVal == "dark") {
            _setColorMode(storageVal);
            return;
        }

        const applySystemMode = (event) => {
            _setColorMode(event.matches ? "dark" : "light");
        };
        applySystemMode(media);
        media.addEventListener("change", applySystemMode);
        return () => media.removeEventListener("change", applySystemMode);
    }, []);

    return (
        <ThemeContext value={{ colorMode, setColorMode }}>
            {children}
        </ThemeContext>
    );
}
