import { index, route, layout } from "@react-router/dev/routes";

export default [
    layout("routes/normal_layout.tsx", [
        // ホーム画面
        route("/", "routes/home.tsx"),
        route("/for-beginners", "routes/for_beginners.tsx"),

        // ユーザ画面
        route("/users/:userName", "routes/userpage.tsx"),

        // 設定画面
        layout("routes/login_layout.tsx", { id: "setting_login_guard" }, [
            route("/settings", "routes/settings.tsx"),
        ]),

        // ↓問題
        route("/problems", "routes/problems.tsx"),

        layout("routes/problem_page_layout.tsx", [
            route("/problems/no/:problemId", "routes/problem_page.tsx"),
            route("/problems/no/:problemId/submissions", "routes/problem_submissions.tsx"),
            route("/problems/no/:problemId/submissions/:submissionId", "routes/problem_submission.tsx"),
            route("/problems/no/:problemId/editorial", "routes/problem_editorial.tsx"),
        ]),

        // ↓問題セット
        route("/problemsets/", "routes/problemsets.tsx"),
        route("/problemsets/no/:problemsetId", "routes/problemset_page.tsx"),

        // ↓プライバシーポリシー
        route("/privacy-policy", "routes/privacy_policy.tsx"),

        // ↓提出一覧
        route("/submissions", "routes/submissions.tsx"),

        // ↓ランキング
        route("/ranking", "routes/ranking.tsx"),

        // ↓サインイン・ログイン画面
        route("/signup", "routes/signup.tsx"),
        route("/login", "routes/login.tsx"),

        // ↓コントロールパネル
        layout("routes/admin_layout.tsx", [
            route("/control-panel", "routes/control_panel.tsx"),

            route("/control-panel/problems", "routes/control_panel_problems.tsx"),
            route("/control-panel/problems/no/:problemId", "routes/control_panel_problem.tsx"),
            route("/control-panel/problems/no/:problemId/testcase", "routes/control_panel_problem_testcase.tsx"),

            route("/control-panel/problemsets", "routes/control_panel_problemsets.tsx"),
            route("/control-panel/problemsets/no/:problemsetId", "routes/control_panel_problemset.tsx"),
            route("/control-panel/problemsets/no/:problemsetId/set", "routes/control_panel_problemset_set.tsx"),

            route("/control-panel/users", "routes/control_panel_users.tsx"),

            // AI学習支援の管理
            layout("routes/control_panel_llm_layout.tsx", [
                route("/control-panel/llm", "routes/control_panel_llm.tsx"),
                route("/control-panel/llm/usage", "routes/control_panel_llm_usage.tsx"),
                route("/control-panel/llm/limits", "routes/control_panel_llm_limits.tsx"),
                route("/control-panel/llm/violations", "routes/control_panel_llm_violations.tsx"),
                route("/control-panel/llm/conversations", "routes/control_panel_llm_conversations.tsx"),
                route("/control-panel/llm/conversations/:conversationId", "routes/control_panel_llm_conversation.tsx"),
            ]),
        ]),
    ]),
    // AI学習支援は通常サイトとは独立したワークスペースとして表示する。
    layout("routes/llm_layout.tsx", [
        route("/llm/chat/:conversationId", "routes/llm_chat.tsx"),
    ]),
];
