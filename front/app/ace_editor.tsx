import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-d";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/theme-chrome";
import "ace-builds/src-noconflict/theme-solarized_dark";

import { useColorMode } from "./contexts";

// ジャッジが対応していない言語名が来ても "text" に落とすので、
// 表に載っていないキーを引くことがある。
const normalizedLanguage: Record<string, string | undefined> = {
    C: "c_cpp",
    "C++": "c_cpp",
    D: "d",
    go: "golang",
    TypeScript: "typescript",
    JavaScript: "javascript",
    Java: "java",
    Python3: "python",
    html: "html",
};

function getTheme () {
    const colorModeObj = useColorMode();

    if (colorModeObj == undefined || colorModeObj.colorMode == "light") {
        return "chrome";
    }
    return "solarized_dark";
}

// workerを使おうとするとトラブるので使わない。
// setOptionsで設定可能
// 行数の自動調節もsetOptionsでできるのを発見した

export function AceEditorReadOnly ({ language, value, expand }: { language: string; value: string; expand?: boolean }) {
    console.log(getTheme());
    const lineCount = value.split(/\r\n|\r|\n/).length;

    const line = expand
                ? lineCount
                : 20 < lineCount
                    ? 20
                    : lineCount;

    return (
        <div className="ace-container">
            <AceEditor
                mode={normalizedLanguage[language] ?? "text"}
                theme={getTheme()}
                value={value}
                width="100%"
                fontSize={16}
                readOnly={true}
                showPrintMargin={false}
                highlightActiveLine={false}
                tabSize={4}
                setOptions={{
                    useWorker: false,
                    // showLineNumbers はコンポーネントのpropsではなくAceのオプション。
                    // 直接渡してもreact-aceが素通しするだけで効かない。
                    showLineNumbers: true,
                    maxLines: line,
                }}
            />
        </div>
    );
}

export function AceEditorWritable ({ language, value, onChange }: { language: string; value: string; onChange: (value: string) => void }) {
    const lineCount = value.split(/\r\n|\r|\n/).length;

    const line = lineCount < 20
                    ? 20
                    : lineCount;

    return (
        <div className="ace-container">
            <AceEditor
                mode={normalizedLanguage[language] ?? "text"}
                theme={getTheme()}
                value={value}
                width="100%"
                fontSize={16}
                onChange={onChange}
                showPrintMargin={false}
                tabSize={4}
                setOptions={{
                    useWorker: false,
                    showLineNumbers: true,
                    minLines: line,
                    maxLines: line,
                }}
            />
        </div>
    );
}
