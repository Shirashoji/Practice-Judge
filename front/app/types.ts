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
