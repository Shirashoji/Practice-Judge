// 会話の共有設定の初回選択。
//
// 既定値を設けず、初めてAI機能を使うときに必ず本人に選ばせる。
// 黙ってどちらかに倒すと同意として成立しないため。
// サーバ側でも未設定なら409を返すので、この画面はUIの都合ではなく本当のゲートになっている。

import { useState } from 'react';
import { Link } from 'react-router';
import { updateSettings } from './client';

function Plan ({ title, limitText, bullets, selected, onSelect, recommended }: any) {
    return (
        <article
            className={selected ? 'llm-plan llm-plan-selected' : 'llm-plan'}
            onClick={onSelect}
            style={{ cursor: 'pointer' }}
        >
            <label style={{ cursor: 'pointer' }}>
                <input type="radio" checked={selected} onChange={onSelect} />
                <strong>{title}</strong>
                {recommended && <span className="llm-badge">おすすめ</span>}
            </label>
            <p className="llm-plan-limit">{limitText}</p>
            <ul>
                {bullets.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
        </article>
    );
}

function formatLimit (limit: any) {
    if (limit == null) {
        return '—';
    }
    if (limit.mode === 'unlimited') {
        return '無制限';
    }
    return `毎月 $${Number(limit.limitUsd).toFixed(2)} まで`;
}

// props:
//   budget  … /api/llm/settings のbudget（両方の枠が入っている）
//   onDone  … 選択が完了したときに呼ばれる
//   onCancel… 閉じるときに呼ばれる（省略可）
export function ShareModeGate ({ budget, onDone, onCancel }: any) {
    const [choice, setChoice] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const shared = budget?.limits?.shared;
    const priv = budget?.limits?.private;

    async function save () {
        if (choice == null) {
            setMsg('どちらかを選択してください。');
            return;
        }
        setSaving(true);
        setMsg('');
        try {
            await updateSettings({ shareMode: choice });
            onDone(choice);
        }
        catch (e: any) {
            setMsg(e.message ?? '保存に失敗しました。');
        }
        setSaving(false);
    }

    return (
        <article className="llm-gate">
            <h3>AI学習支援を使う前に</h3>
            <p>
                AIとの会話は<strong>どちらを選んでも記録されます</strong>（不正利用の調査のため）。
                違うのは、管理者が日常的に閲覧できるかどうかと、毎月使える金額です。
            </p>

            <div className="llm-plan-grid">
                <Plan
                    title="会話を共有する"
                    recommended={shared?.mode === 'unlimited' || (priv && shared && shared.limitUsd > priv.limitUsd)}
                    limitText={formatLimit(shared)}
                    selected={choice === 'shared'}
                    onSelect={() => setChoice('shared')}
                    bullets={[
                        '管理者があなたの会話を閲覧できます',
                        '教材の改善や、つまずきやすい点の把握に使われます',
                        '利用できる金額が多くなります',
                    ]}
                />
                <Plan
                    title="会話を共有しない"
                    limitText={formatLimit(priv)}
                    selected={choice === 'private'}
                    onSelect={() => setChoice('private')}
                    bullets={[
                        '管理者は通常あなたの会話を閲覧しません',
                        'ログ自体は不正調査のために保存されます',
                        '利用できる金額が少なくなります',
                    ]}
                />
            </div>

            <p className="llm-note">
                なお、ガイドライン違反（直接の解答の要求、無関係な会話）が記録された場合は、
                共有しない設定であっても、その会話と以降の会話が強制的に閲覧対象になります。
                詳しくは<Link to="/privacy-policy">プライバシーポリシー</Link>をご覧ください。
            </p>

            <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
                <button type="button" onClick={save} disabled={saving} aria-busy={saving ? 'true' : 'false'}>
                    この設定ではじめる
                </button>
                {onCancel && (
                    <button type="button" className="secondary outline" onClick={onCancel}>
                        やめる
                    </button>
                )}
                {msg !== '' && <span className="pico-color-red-500">{msg}</span>}
            </div>
            <p className="llm-note">この設定は後から「設定」画面でいつでも変更できます。</p>
        </article>
    );
}

export default ShareModeGate;
