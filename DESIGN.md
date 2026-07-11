# shikaku 設計ドキュメント

## プロジェクト概要

Googleアカウントでのログインを必須とした、個人学習用の資格まとめサイト。
現在は宅地建物取引士（宅建）のコンテンツを収録している。

| 項目 | 値 |
|---|---|
| GitHubリポジトリ | ryotomi/shikaku |
| 公開URL | https://ryotomi.github.io/shikaku/ |
| ホスティング | GitHub Pages（mainブランチ / root） |
| 認証 | Firebase Authentication（Googleログインのみ） |

---

## 技術スタック

| レイヤー | 使用技術 |
|---|---|
| ホスティング | GitHub Pages（静的HTML） |
| 認証 | Firebase Authentication v10（CDN経由） |
| スタイル | 独自CSS（invst design-system 準拠） |
| フォント | Noto Sans JP / Shippori Mincho（Google Fonts） |
| バックエンド | なし（フロントエンドのみ） |

Firebase Hostingは**使用しない**。ホスティングはGitHub Pagesに統一し、Firebaseは認証機能のみ利用する。

---

## Firebase設定

| 項目 | 値 |
|---|---|
| プロジェクト名 | My First Project |
| プロジェクトID | dev-smoke-308500 |
| プロジェクト番号（messagingSenderId） | 787519016500 |
| appId | 1:787519016500:web:decc4d4a20145659f44461 |
| authDomain | dev-smoke-308500.firebaseapp.com |
| 承認済みドメイン | ryotomi.github.io |
| ログイン方法 | Google のみ |

---

## ディレクトリ構造

```
docs/shikaku/               ← ローカル作業ディレクトリ
├── DESIGN.md               ← 本ドキュメント
├── index.html              # ログインページ（未認証ユーザーの入口）
├── home.html               # ログイン後ホーム（ユーザー情報・ログアウト）
├── css/
│   └── style.css           # 共通スタイルシート
└── takken/                 # 宅建コンテンツ
    └── docs/
        ├── overview.md     # 試験概要（markdownソース）
        └── overview.html   # 試験概要ページ（認証保護済み）
```

---

## 認証フロー

```
ユーザーがURLにアクセス
        ↓
onAuthStateChanged で認証状態を確認
        ↓
  ┌─────────────────────────┐
  │ 未ログイン              │ ログイン済み
  ↓                         ↓
index.html へリダイレクト   #page-content を表示
        ↓
  Googleでログインボタン
        ↓
  signInWithPopup（Google）
        ↓
  認証成功 → home.html へ
```

### ページ別の認証設定

| ファイル | 認証チェック | 役割 |
|---|---|---|
| `index.html` | ログイン済みなら home.html へ転送 | ログインページ |
| `home.html` | 未ログインなら index.html へ転送 | ログイン後ホーム |
| `takken/docs/overview.html` | 未ログインなら index.html へ転送 | コンテンツページ |

---

## 新しいコンテンツページを追加する手順

### 1. HTMLファイルを作成

`docs/shikaku/` 以下の適切なディレクトリに `.html` ファイルを作成する。

### 2. 認証チェックを組み込む

`<head>` 末尾に以下を追加し、コンテンツ全体を `<div id="page-content">` で囲む。

```html
<!-- <head> 末尾に追加 -->
<style>
  #page-content { display: none; }
</style>

<!-- <body> 直後に追加 -->
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

  const firebaseConfig = {
    apiKey:            "AIzaSyA23ZY-H2JPzdlG1Fm8bfLW34y9XEMldrU",
    authDomain:        "dev-smoke-308500.firebaseapp.com",
    projectId:         "dev-smoke-308500",
    storageBucket:     "dev-smoke-308500.firebasestorage.app",
    messagingSenderId: "787519016500",
    appId:             "1:787519016500:web:decc4d4a20145659f44461",
  };

  const auth = getAuth(initializeApp(firebaseConfig));
  onAuthStateChanged(auth, user => {
    if (!user) location.href = "/shikaku/index.html";
    else document.getElementById("page-content").style.display = "";
  });
</script>

<!-- コンテンツ全体 -->
<div id="page-content">
  ...
</div>
```

### 3. CSSを参照する

`css/style.css` への相対パスをページの深さに合わせて調整する。

| ページの場所 | パス |
|---|---|
| `shikaku/` 直下 | `css/style.css` |
| `shikaku/takken/` | `../css/style.css` |
| `shikaku/takken/docs/` | `../../css/style.css` |

### 4. ナビゲーションに追加

各ページの `.nav-list` に `<li><a class="nav-link" href="...">ページ名</a></li>` を追加する。
現在のページには `class="nav-link current"` を付与する。

### 5. GitHubへプッシュ

```bash
cp docs/shikaku/<新ファイル> /tmp/.../shikaku/<対応パス>
cd /tmp/.../shikaku
git add <ファイル> && git commit -m "Add ..." && git push
```

---

## デザインシステム

invst（docs/invst/public/css/style.css）と同一のデザインシステムを継承している。

### カラーパレット

| 変数 | 値 | 主な用途 |
|---|---|---|
| `--color-primary` | `#2b4b6e` | ヘッダー背景・見出し・ナビアクティブ |
| `--color-primary-dark` | `#1a3a5c` | フッター背景 |
| `--color-accent` | `#c04c38` | リンク・バッジ・左ボーダー強調 |
| `--color-bg` | `#f8f6f1` | ページ背景（奇数セクション） |
| `--color-bg-alt` | `#eeeae3` | 偶数セクション・テーブルヘッダー |
| `--color-border` | `#d4cfc5` | 罫線・枠線 |
| `--color-text` | `#2d2d2d` | 本文テキスト |
| `--color-text-light` | `#5a5a5a` | リード文・補足説明 |
| `--color-text-muted` | `#8a8a8a` | 日付・メタ情報 |

### フォント

```css
--font-primary: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "メイリオ", sans-serif;
--font-accent:  "Shippori Mincho", "游明朝", "YuMincho", serif;
```

### shikaku固有コンポーネント

| クラス | 説明 |
|---|---|
| `.data-table` | 汎用テーブル（th: bg-alt/primary色、hover: bg色） |
| `.badge` `.badge-primary` `.badge-accent` | インラインバッジ（丸角ピル型） |
| `.subject-bar` `.bar-segment` | 科目割合の横棒グラフ |
| `.bar-legend` | バーグラフの凡例 |
| `.flow` `.flow-step` `.flow-num` | 手続きフロー（番号付きステップ） |
| `.exclusive-list` | 左アクセントボーダー付きリスト |

### ページ構造テンプレート

```html
<header class="site-header">
  <div class="container">
    <div class="site-name">資格まとめ</div>
    <div class="site-role">サブタイトル</div>
  </div>
</header>

<nav class="site-nav">
  <div class="container">
    <ul class="nav-list">
      <li><a class="nav-link current" href="...">現在ページ</a></li>
      <li><a class="nav-link" href="...">他ページ</a></li>
    </ul>
  </div>
</nav>

<main>
  <section class="section"> <!-- 奇数: bg / 偶数: bg-alt は自動 -->
    <div class="container">
      <h2 class="section-title">セクション名</h2>
      <p class="lead">説明文</p>
      <!-- コンテンツ -->
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="container">
    <div>資格まとめ — サブタイトル</div>
    <div class="disclaimer">免責事項</div>
  </div>
</footer>
```

---

## 過去問データソース

### 方針：自作JSON ＋ AI生成

公式（RETIO）が公開する過去問PDFに構造化API・JSONは存在しない。
著作権はRETIOに帰属し二次配布には許諾が必要なため、**問題文・解説はAIで生成したオリジナル文を使用する**。
本サイトはGoogle Authで非公開のため個人学習用途として運用する。

| 項目 | 内容 |
|---|---|
| 問題文・解説 | AIが出題傾向・法令に基づき生成（著作権フリー） |
| 正解番号 | RETIOが公式公開している正解番号表を参照 |
| 管理形式 | 科目別JSONファイル（`takken/data/`以下） |
| 参照元PDF | [RETIO 過去問・正解番号表](https://www.retio.or.jp/exam/past_ques_ans/other/) |

### JSONスキーマ

```json
{
  "id": "gyoho-001",
  "subject": "宅建業法",
  "topic": "免許",
  "question": "問題文（本文）",
  "choices": [
    "1. 選択肢1",
    "2. 選択肢2",
    "3. 選択肢3",
    "4. 選択肢4"
  ],
  "answer": 2,
  "explanation": "正解の解説文。なぜ正しいか・他の選択肢がなぜ誤りかを記載。",
  "law": "宅建業法第○条",
  "difficulty": "基本"
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | `{科目コード}-{3桁連番}`（例: gyoho-001） |
| `subject` | string | 宅建業法 / 権利関係 / 法令上の制限 / 税・その他 |
| `topic` | string | 小トピック（免許・重説・媒介契約 等） |
| `question` | string | 問題文 |
| `choices` | string[4] | 選択肢（"1. ..."〜"4. ..."） |
| `answer` | number | 正解番号（1〜4） |
| `explanation` | string | 解説文 |
| `law` | string | 根拠条文（任意） |
| `difficulty` | string | 基本 / 標準 / 応用 |

### データファイル構成

```
takken/data/
├── gyoho.json    # 宅建業法（目標: 60問）
├── kenri.json    # 権利関係（目標: 42問）
├── horei.json    # 法令上の制限（目標: 24問）
└── zei.json      # 税・その他（目標: 24問）
```

各ファイルの構造：
```json
{
  "subject": "宅建業法",
  "updated": "2026-07-11",
  "questions": [ { ...問題オブジェクト }, ... ]
}
```

---

## 今後の拡張予定コンテンツ

- `takken/practice.html` — 過去問演習ページ（科目別・ランダム出題）
- `takken/docs/kenri.html` — 権利関係（民法等）まとめ
- `takken/docs/gyoho.html` — 宅建業法まとめ
- `takken/docs/horei.html` — 法令上の制限まとめ
- `takken/docs/zei.html` — 税・その他まとめ
