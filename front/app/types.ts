// 複数のファイルから参照する型だけを置く。
// 1つのルートでしか使わない型は、そのルートのファイル内に書く。

// GET /api/auth/me の応答。未ログインでもnullではなく
// { login: false, username: "guest", role: "user" } が返る（api/logincheck.js の checkUserStatus）。
export type LoginInfo = {
    login: boolean;
    username: string;
    role: string;
};

// レイアウトがOutletに流している値。normal_layout / llm_layout が作り、
// login_layout / admin_layout / *_page_layout はそのまま素通しするので、全経路でこの形。
export type AppOutletContext = {
    loginInfo: LoginInfo;
};

// GET /api/problems の1行（api/problems.js のSELECTと対応）。
// is_published はSQLite側がINTEGERなので 0 / 1 で来る。
export type ProblemListItem = {
    id: number;
    title: string;
    difficulty: number;
    is_published: number;
};

// GET /api/problemsets の1行。管理画面が使う /all は SELECT * だが、
// 画面が読むのは id と title だけ。
export type ProblemSetListItem = {
    id: number;
    title: string;
};

// 提出一覧の1行（api/submissions.js と api/problem.js のSELECTと対応）。
// problem_id は問題ページ配下の一覧には無い（URLの問題IDを使うので返していない）ため、
// 必要な画面だけ交差型で足す。
// ジャッジ中は time_sec / memory_kb がまだ埋まっていない。
export type SubmissionListItem = {
    id: number;
    problem_title: string;
    difficulty: number;
    username: string;
    code_language: string;
    status: string;
    time_sec: number | null;
    memory_kb: number | null;
    created_at: string;
    bytes: number;
};

// GET /api/problems/no/:id/submissions/:submissionId の each（api/problem.js のSELECTと対応）。
// ジャッジ中のテストケースは status が空で time_sec / memory_kb も埋まっていない。
export type SubmissionTestcaseResult = {
    testcase_name: string;
    status: string;
    time_sec: number | null;
    memory_kb: number | null;
};
