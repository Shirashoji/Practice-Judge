import type { Route } from "./+types/control_panel_problem_testcase";
import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { BASEURL } from '../backend_url';

export function meta ({ params, data }: Route.MetaArgs) {
    return [
        { title: `問題 #${params.problemId} テストケース編集 - Practice Judge` },
    ];
}

export async function clientLoader ({ request, params }: Route.ClientLoaderArgs) {
    const re = await fetch(new URL(`/api/problems/no/${params.problemId}/testcase`, BASEURL).href, {
        credentials: "include",
    });
    const res = await re.json();
    return res;
}

export default function ControlPanelTestcase ({ loaderData, params }: Route.ComponentProps) {
    const problemId = params.problemId;
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testcases, setTestcases] = useState(loaderData);
    const [focusing, setFocusing] = useState(null);
    const [testcaseName, setTestcaseName] = useState("");
    const [inputSubmission, setInputSubmission] = useState("");
    const [inputJudge, setInputJudge] = useState("");

    const [message, setMessage] = useState("");
    const [uploading, setUploading] = useState(false);
    const fileinputRef = useRef<HTMLInputElement>(null);

    const submitZipfile = async () => {
        // ファイル未選択でもボタンは押せる。以前はundefinedをappendしてサーバ側で
        // エラーにしていたので、ここで気付けるようにする。
        const zipfile = fileinputRef.current?.files?.[0];
        if (zipfile == null) {
            setMessage("エラー: zipファイルを選択してください。");
            return;
        }

        const data = new FormData();
        data.append('testcase-zip', zipfile);
        setUploading(true);
        const f = fetch(new URL(`/api/problems/no/${problemId}/testcase/upload-zip`, BASEURL).href, {
            credentials: "include",
            method: "POST",
            body: data,
        });
        const ret = await f;
        setUploading(false);
        if (ret.ok) {
            if (fileinputRef.current != null) {
                fileinputRef.current.value = "";
            }
            const rj = await ret.json();
            setMessage(rj.message);
        }
        else {
            const rj = await ret.json();
            setMessage("エラー: " + rj.error);
        }

        refetchTestcase();
    };

    // 保存
    const saveChange = async () => {
        if (focusing == null) {
            return;
        }

        setSaving(true);
        const payload = [
            {
                id: focusing,
                testcase_name: testcaseName,
                input_submission: inputSubmission,
                input_judge: inputJudge,
            },
        ];

        const fret = await fetch(new URL(`/api/problems/no/${problemId}/testcase/update`, BASEURL).href, {
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            method: "PUT",
            body: JSON.stringify(payload),
        });

        if (!fret.ok) {
            const data = await fret.json();
            console.error("保存失敗: ", data);
        }
        setSaving(false);

        refetchTestcase();
    };

    const refetchTestcase = async () => {
        // 再fetch
        const fdata = await fetch(new URL(`/api/problems/no/${problemId}/testcase`, BASEURL).href, {
            credentials: "include",
        });
        const data = await fdata.json();
        setTestcases(data);
    };

    const changeFocusing = async (nextId) => {
        setLoading(true);
        await saveChange();

        setTestcaseName("");
        setInputSubmission("");
        setInputJudge("");

        const datafetch = await fetch(new URL(`/api/problems/no/${problemId}/testcase/${nextId}`, BASEURL).href, {
            credentials: "include",
            method: "GET",
        });

        const data = await datafetch.json();
        setTestcaseName(data.testcase_name);
        setInputSubmission(data.input_submission);
        setInputJudge(data.input_judge);
        setLoading(false);
    };

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li><Link to="/control-panel/problems">問題一覧</Link></li>
                    <li>テストケース編集 #{problemId}</li>
                </ul>
            </nav>

            <hr />

            <h2>テストケース編集 #{problemId}</h2>
            <div className="pico-background-slate-100" style={{ padding: "1em", marginBottom: "1em" }}>
                <label>
                    <strong>テストケース一括アップロード</strong>
                    <input
                        type="file"
                        accept=".zip"
                        ref={fileinputRef}
                    />
                </label>
                <button
                    onClick={submitZipfile}
                    disabled={uploading}
                    aria-busy={uploading ? "true" : "false"}
                >アップロード</button>
                {message != "" && <p className={message.includes("エラー") ? "pico-color-red-450" : "pico-color-lime-150"}>{message}</p>}
                <ul>
                    <li>あるファイル名xについて、x.inとx.outの両方揃っている場合のみxという名前でテストケースを追加します。</li>
                    <li>同じ名前のテストケースがすでに追加済みの場合でも、上書きではなくさらに追加されます。</li>
                </ul>

                <p>
                次のような構造のディレクトリをzipにしてアップロードしてください。
                .inと.outが両方揃っているテストケースのみ追加されます。
                </p>
                <pre style={{ whiteSpace: "pre-wrap" }}>{`data/
├── test_01.in
├── test_01.out
├── test_02.in
├── test_02.out
├── test_03.in
└── test_03.out`}</pre>
            </div>

            <div className="grid">

                <div className="container">
                    <EditorLeft
                        problemId={problemId}
                        saveChange={saveChange}
                        saving={saving}
                        testcases={testcases}
                        setTestcases={setTestcases}
                        focusing={focusing}
                        setFocusing={setFocusing}
                        changeFocusing={changeFocusing}
                        refetchTestcase={refetchTestcase}
                    />
                </div>

                <div className="container">
                    <EditorRight
                        problemId={problemId}
                        focusing={focusing}
                        setFocusing={setFocusing}
                        loading={loading}
                        refetchTestcase={refetchTestcase}
                        testcaseName={testcaseName}
                        setTestcaseName={setTestcaseName}
                        inputSubmission={inputSubmission}
                        setInputSubmission={setInputSubmission}
                        inputJudge={inputJudge}
                        setInputJudge={setInputJudge}
                    />
                </div>
            </div>
        </main>
    );
}

function EditorLeft ({
    problemId,
    saveChange,
    saving,
    testcases, setTestcases,
    focusing, setFocusing,
    changeFocusing,
    refetchTestcase,
    }) {

    // アニメーション用
    const [creatingTestcase, setCreatingTestcase] = useState(false);
    const [savingChange, setSavingChange] = useState(false);

    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    const createNew = async () => {
        if (!window.confirm("テストケースを追加します。")) {
            return;
        }

        setCreatingTestcase(true);
        await fetch(new URL(`/api/problems/no/${problemId}/testcase/create`, BASEURL).href, {
            credentials: "include",
            method: "POST",
        });

        refetchTestcase();
        setCreatingTestcase(false);
        setFocusing(null);
    };

    const deleteAllTestCase = async () => {
        if (!window.confirm("すべてのテストケースを削除しますか？")) {
            return;
        }
        setDeleting(true);

        const reqs = [];
        for (const t of testcases) {
            const f = fetch(new URL(`/api/problems/no/${problemId}/testcase/delete`, BASEURL).href, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: t.id }),
                credentials: "include",
            });
            reqs.push(f);
        }

        try {
            await Promise.all(reqs);
        }
        catch (e) {
            console.error("テストケース削除失敗: ", e);
        }
        finally {
            refetchTestcase();
            setDeleting(false);
            setFocusing(null);
        }
    };

    return (
    <>
        <div style={{ marginBottom: "1em"}}>
            <div className="grid">
                <button
                    onClick={createNew}
                    disabled={creatingTestcase}
                    aria-busy={creatingTestcase ? "true" : "false"}
                >
                    追加
                </button>
                <button
                    onClick={saveChange}
                    disabled={saving}
                    aria-busy={saving ? "true" : "false"}
                >
                    変更を保存
                </button>
            </div>
        </div>
        <Testcases
            testcases={testcases}
            setTestcases={setTestcases}
            focusing={focusing}
            changeFocusing={changeFocusing}
            setFocusing={setFocusing}
        />

        <button
            style={{ backgroundColor: "rgb(238, 64, 46)" }}
            onClick={deleteAllTestCase}
            disabled={deleting}
            aria-busy={deleting ? "true" : "false" }
        >
            すべて削除
        </button>

        {deleteError !== "" && <p><span className="pico-color-red-450">エラー: {deleteError}</span></p>}
    </>
    );
}

function Testcases ({
    changeFocusing,
    testcases, setTestcases,
    focusing, setFocusing,
}) {
    if (testcases.length == 0) {
        return (
            <p>まだテストケースがありません。</p>
        );
    }

    return (
        <table>
            <tbody>
                {testcases.map((tc) => {
                    let classVal = "outline";
                    if (tc.id == focusing) {
                        classVal += " pico-background-pumpkin-150";
                    }
                    return (
                        <tr key={tc.id}>
                            <td
                                className={classVal}
                                onClick={async () => {
                                    await changeFocusing(tc.id);
                                    setFocusing(tc.id);
                                }}
                                role="button"
                            >
                                <div>
                                    {tc.testcase_name == ""
                                        ? <span className="pico-color-grey-300">テストケース名を設定してください</span>
                                        : <span style={{ whiteSpace: "pre" }}>{tc.testcase_name}</span>
                                    }
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function EditorRight ({
    problemId,
    focusing, setFocusing,
    loading,
    refetchTestcase,
    testcaseName, setTestcaseName,
    inputSubmission, setInputSubmission,
    inputJudge, setInputJudge,
    }) {

    // アニメーション用
    const [deletingTestcase, setDeletingTestcase] = useState(false);

    const deleteTestcase = async () => {
        if (!window.confirm("テストケースを削除しますか？")) {
            return;
        }
        setDeletingTestcase(true);
        try {
            await fetch(new URL(`/api/problems/no/${problemId}/testcase/delete`, BASEURL).href, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: focusing }),
                credentials: "include",
            });
        }
        catch (e) {
            console.error("テストケース削除失敗: ", e);
        }
        finally {
            refetchTestcase();
            setDeletingTestcase(false);
            setFocusing(null);
        }
    };

    if (loading) {
        return (
            <p style={{ marginBottom: "100vh" }}>
                読み込み中...
            </p>
        );
    }
    if (focusing == null) {
        return (
            <p>
                テストケースを選択してください。
            </p>
        );
    }

    return (
    <>
        <div>
            <label>Testcase Name</label>
            <input
                type="text"
                value={testcaseName}
                onChange={(e) => {
                    setTestcaseName(e.target.value);
                }}
            />
        </div>

        <div>
            <label>Input (Submission)</label>
            <textarea
                value={inputSubmission}
                onChange={(e) => {
                    setInputSubmission(e.target.value);
                }}
                rows={5}
            ></textarea>
        </div>

        <div>
            <label>Input (Judge)</label>
            <textarea
                value={inputJudge}
                onChange={(e) => {
                    setInputJudge(e.target.value);
                }}
                rows={5}
            ></textarea>
        </div>
        <button
            onClick={deleteTestcase}
            disabled={deletingTestcase}
            aria-busy={deletingTestcase ? "true" : "false"}
            >
            削除
        </button>
    </>
    );
}
