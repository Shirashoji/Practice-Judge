import type { Route } from "./+types/control_panel";
import { Link } from 'react-router';

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: "管理画面 - Practice Judge" },
  ];
}

export default function ControlPanel () {
    return (
        <>
            <main className="container">
                <nav aria-label="breadcrumb">
                    <ul>
                        <li>コントロールパネル</li>
                    </ul>
                </nav>

                <hr />

                <h2>コントロールパネル（管理者用）</h2>
                <p><Link to="/control-panel/problems">問題管理</Link></p>
                <p><Link to="/control-panel/problemsets">問題セット管理</Link></p>
                <p><Link to="/control-panel/users">ユーザ管理</Link></p>

                <h3>AI学習支援</h3>
                <p><Link to="/control-panel/llm">設定（無料枠・モデル）</Link></p>
                <p><Link to="/control-panel/llm/usage">利用分析</Link></p>
                <p><Link to="/control-panel/llm/limits">ユーザー別上限</Link></p>
                <p><Link to="/control-panel/llm/violations">警告・違反記録</Link></p>
                <p><Link to="/control-panel/llm/conversations">会話の監査</Link></p>
            </main>
        </>
    );
}
