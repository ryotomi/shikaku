#!/usr/bin/env python3
"""行政書士データ 検証ハーネス（harness engineering の中核）。

過去問JSON・flashcards.json・questions.js の整合性を機械的に検証する。
生成AIの出力をそのまま信用せず、この決定論的ゲートを必ず通す。

使い方:
    cd shikaku/gyosei/data && python3 ../docs/validate.py
    （終了コード 0=合格 / 1=不合格。CIやコミット前フックにも組み込める）
"""
import json, sys, glob, os, collections

SUBJECTS = {
    "kisohogaku": "基礎法学", "kenpo": "憲法", "gyoseiho": "行政法",
    "minpo": "民法", "shoho": "商法・会社法", "chishiki": "基礎知識",
}
# 正解位置の偏りアラート閾値（どれか1つの位置が全体のこの割合を超えたら警告）
BIAS_WARN = 0.35

def main(data_dir="."):
    errors, warns = [], []
    all_ids, all_q = [], []

    # --- 過去問JSON ---
    for slug, subj in SUBJECTS.items():
        path = os.path.join(data_dir, slug + ".json")
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            errors.append(f"{slug}.json: 読み込み/パース失敗 {e}")
            continue
        if d.get("subject") != subj:
            errors.append(f"{slug}.json: subject '{d.get('subject')}' != '{subj}'")
        for q in d.get("questions", []):
            all_ids.append(q.get("id")); all_q.append(q)
            qid = q.get("id", "?")
            if q.get("subject") != subj:
                errors.append(f"{qid}: subject不一致 {q.get('subject')}")
            if not str(qid).startswith(slug + "-"):
                errors.append(f"{qid}: id接頭辞が {slug}- でない")
            ch = q.get("choices", [])
            if len(ch) != 5:
                errors.append(f"{qid}: choices数 {len(ch)} (5肢択一は5)")
            a = q.get("answer")
            if not (isinstance(a, int) and 1 <= a <= len(ch)):
                errors.append(f"{qid}: answer範囲外 {a}")
            for key in ("question", "explanation", "topic"):
                if not q.get(key):
                    errors.append(f"{qid}: {key} が空")

    # id重複
    dup = [i for i, c in collections.Counter(all_ids).items() if c > 1]
    if dup:
        errors.append(f"過去問ID重複: {dup}")

    # 正解位置の偏り（品質警告）
    if all_q:
        pos = collections.Counter(q["answer"] for q in all_q if isinstance(q.get("answer"), int))
        n = sum(pos.values())
        for p in range(1, 6):
            frac = pos.get(p, 0) / n
            if frac > BIAS_WARN:
                warns.append(f"正解位置 {p} が {frac:.0%} に偏在（閾値{BIAS_WARN:.0%}）")
        missing = [p for p in range(1, 6) if pos.get(p, 0) == 0]
        if missing:
            warns.append(f"正解位置 {missing} が0件（分散不足）")

    # 難易度分散（品質警告）
    if all_q:
        diffs = collections.Counter(q.get("difficulty") for q in all_q)
        if len(diffs) <= 1:
            warns.append(f"難易度が単一 {dict(diffs)}（基本/標準/応用の分散推奨）")

    # --- flashcards.json ---
    try:
        cards = json.load(open(os.path.join(data_dir, "flashcards.json"), encoding="utf-8"))["cards"]
        fids = [c.get("id") for c in cards]
        fterms = [c.get("term") for c in cards]
        for i, c in collections.Counter(fids).items():
            if c > 1: errors.append(f"用語ID重複: {i}")
        for t, c in collections.Counter(fterms).items():
            if c > 1: errors.append(f"用語重複: {t}")
        valid = set(SUBJECTS.values())
        for c in cards:
            if c.get("subject") not in valid:
                errors.append(f"card {c.get('id')}: subject不正 {c.get('subject')}")
            if not c.get("definition"):
                errors.append(f"card {c.get('id')}: 定義が空")
    except Exception as e:
        errors.append(f"flashcards.json: 失敗 {e}")
        cards = []

    # --- questions.js 整合 ---
    try:
        js = open(os.path.join(data_dir, "questions.js"), encoding="utf-8").read()
        js_ids = js.count('"id"')
        if js_ids != len(all_q):
            errors.append(f"questions.js のID数 {js_ids} != JSON合計 {len(all_q)}（再生成が必要）")
    except Exception as e:
        errors.append(f"questions.js: 失敗 {e}")

    # --- 出力 ---
    print(f"過去問 {len(all_q)}問 / 用語 {len(cards)}語")
    for w in warns:
        print("  ⚠ WARN:", w)
    for e in errors:
        print("  ✗ ERROR:", e)
    if errors:
        print(f"不合格: エラー{len(errors)}件 / 警告{len(warns)}件")
        return 1
    print(f"合格: エラー0 / 警告{len(warns)}件")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
