export const meta = {
  name: 'verify-enrich-gyosei',
  description: '行政書士の過去問・用語を科目ごとに並列検証し、指摘を敵対的に確認（多数決）したうえで、正解位置バイアス是正・難易度分散・記述/多肢の新規案を統合レポート化する',
  phases: [
    { title: 'Verify',      detail: '科目×内容を並列で正確性検証' },
    { title: 'Adversarial', detail: '各指摘を独立エージェントで反証（多数決）' },
    { title: 'Enrich',      detail: '正解位置の均等化・難易度分散・記述/多肢の新規生成' },
  ],
}

// このスクリプトは「提案①（Workflow）」の実体。実行すると検証・改善“案”を
// 構造化レポートとして返す。JSONへの反映は main ループ側が validate.py ゲートを
// 通しながら行う（生成物を無検証で書き換えない = harness engineering）。
//
// 実行例:  Workflow({ scriptPath: "shikaku/gyosei/docs/workflows/verify-enrich-gyosei.workflow.js" })

const SUBJECTS = [
  { slug: 'gyoseiho',   name: '行政法' },
  { slug: 'minpo',      name: '民法' },
  { slug: 'kenpo',      name: '憲法' },
  { slug: 'shoho',      name: '商法・会社法' },
  { slug: 'chishiki',   name: '基礎知識' },
  { slug: 'kisohogaku', name: '基礎法学' },
]

// 検証エージェントが返す指摘リスト
const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id:            { type: 'string' },
          issueType:     { type: 'string', enum: ['wrong_answer','weak_distractor','citation_error','outdated_law','ambiguous','other'] },
          detail:        { type: 'string' },
          correctedAnswer: { type: ['integer','null'] },
          suggestedFix:  { type: 'string' },
        },
        required: ['id','issueType','detail'],
      },
    },
  },
  required: ['findings'],
}

// 敵対的レビュー（反証）の評決
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    real:   { type: 'boolean' },   // 本当に問題か（不確かなら false に倒す）
    reason: { type: 'string' },
  },
  required: ['real','reason'],
}

// 改善案（バイアス是正・難易度・新形式）
const ENRICH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rebalance: {  // 既存設問の正解位置を1〜5へ均等化する改稿指示
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { id:{type:'string'}, newAnswerPos:{type:'integer'}, reorderedChoices:{type:'array',items:{type:'string'}} },
        required: ['id','newAnswerPos','reorderedChoices'],
      },
    },
    difficulty: {  // 基本/標準/応用の付与
      type: 'array',
      items: { type:'object', additionalProperties:false, properties:{ id:{type:'string'}, difficulty:{type:'string',enum:['基本','標準','応用']} }, required:['id','difficulty'] },
    },
    newItems: {  // 新形式（記述式・多肢選択式）の追加案
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          format:      { type: 'string', enum: ['記述式','多肢選択式'] },
          topic:       { type: 'string' },
          question:    { type: 'string' },
          modelAnswer: { type: 'string' },
          explanation: { type: 'string' },
          law:         { type: 'string' },
        },
        required: ['format','topic','question','modelAnswer','explanation'],
      },
    },
  },
  required: ['rebalance','difficulty','newItems'],
}

const VERIFY_PROMPT = (s) => `あなたは行政書士試験の作問校閲者です。
ファイル shikaku/gyosei/data/${s.slug}.json を読み、${s.name}の全設問を1問ずつ検証してください。
各設問について次を厳密にチェックし、問題がある設問だけを findings に挙げてください（問題なければ挙げない）:
1. answer が指す選択肢が本当に唯一の正解か（誤答肢が実は正しくないか）
2. 各誤答肢が「明確に誤り」かつ「紛らわしい良問レベル」か（自明すぎ/意味不明でないか）
3. law の条文・判例名が実在し設問内容と一致するか
4. 2024〜2025年の法改正（再婚禁止期間廃止・拘禁刑への一本化・嫡出推定改正・個人情報保護法一元化 等）に照らして古くないか
5. 記述が曖昧・重複していないか
確信が持てない指摘は挙げないこと。条文・判例は自分の知識で裏取りし、断定できないものは issueType を other にして detail に「要一次情報確認」と明記。`

const ENRICH_PROMPT = (s) => `あなたは行政書士試験の作問者です。ファイル shikaku/gyosei/data/${s.slug}.json を読み、${s.name}について次の改善案を作成してください:
- rebalance: 正解が特定位置に偏らないよう、既存設問のうち改稿すべきものについて、選択肢を並べ替えた reorderedChoices と新しい正解位置 newAnswerPos（1〜5）を示す。選択肢の文言や正誤内容は変えず順序のみ入れ替える。
- difficulty: 各設問に 基本/標準/応用 を付与（条文知識のみ=基本、複数論点/判例=標準、事例応用=応用）。
- newItems: 行政書士本試験の形式に合わせ、記述式（40字程度・modelAnswer付き）1問と、多肢選択式1問の新規案を作成。`

// ===== Phase 1 + 2: 検証 → 敵対的確認（多数決） =====
const perSubject = await pipeline(
  SUBJECTS,
  s => agent(VERIFY_PROMPT(s), { label: `verify:${s.slug}`, phase: 'Verify', schema: FINDINGS, agentType: 'general-purpose' }),
  (res, s) => parallel((res?.findings || []).map(f => () =>
    // 各指摘を2名の独立スケプティックで反証。過半数が real でなければ棄却。
    parallel([1, 2].map(k => () =>
      agent(`次の校閲指摘が本当に妥当か、独立に反証してください。少しでも疑わしければ real=false に倒すこと。\n指摘: ${JSON.stringify(f)}\n設問は shikaku/gyosei/data/${s.slug}.json の id=${f.id} を参照。`,
        { label: `adv${k}:${f.id}`, phase: 'Adversarial', schema: VERDICT, agentType: 'general-purpose' })
    )).then(vs => {
      const votes = vs.filter(Boolean)
      const real = votes.filter(v => v.real).length >= Math.ceil(votes.length / 2) && votes.length > 0
      return { ...f, subject: s.name, confirmed: real, votes }
    })
  ))
)
const confirmedFixes = perSubject.flat().filter(Boolean).filter(f => f.confirmed)

// ===== Phase 3: 改善案（バイアス是正・難易度・新形式）を科目並列で =====
const enrich = await parallel(
  SUBJECTS.map(s => () =>
    agent(ENRICH_PROMPT(s), { label: `enrich:${s.slug}`, phase: 'Enrich', schema: ENRICH, agentType: 'general-purpose' })
      .then(e => (e ? { subject: s.name, slug: s.slug, ...e } : null))
  )
)

log(`確定修正 ${confirmedFixes.length}件 / 改善案 ${enrich.filter(Boolean).length}科目分を生成`)

// main ループはこの戻り値を受け取り、JSONへ反映 → validate.py → questions.js再生成 の順で確定する。
return {
  confirmedFixes,
  enrich: enrich.filter(Boolean),
  note: 'この出力は“案”。適用は validate.py ゲートを通してから確定すること。',
}
