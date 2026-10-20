// Analysis center (queue A1) — the CEO's questions. Every chart on the
// Analysis center Overview answers one of these and is titled by it; the
// fixed note under the title says how to read the figures (or, while the data
// is not in hand, what the chart will show). Source: BD's "CEO Questions"
// workbook, Rev 1 of 20 Oct 2026 (50 questions in 8 groups) — keep the ids the
// same as that workbook so BD and the page talk about the same question.
//
// The question text is fixed; the figures are not — they come from the live
// bdControl rows (lib/bdControl.ts, lib/analysisCenter.ts).

export interface Bi { en: string; ar: string }

/** In hand today / some of it / must be collected. */
export type QData = 'have' | 'part' | 'missing';

export const QUESTION_GROUPS = ['projects', 'money', 'amendments', 'people', 'renewals', 'suppliers', 'growth', 'opportunity'] as const;
export type QGroup = typeof QUESTION_GROUPS[number];

export const GROUP_LABEL: Record<QGroup, Bi> = {
  projects: { en: 'Our projects today', ar: 'مشروعاتنا اليوم' },
  money: { en: 'Money', ar: 'الموقف المالي' },
  amendments: { en: 'Changes & amendments', ar: 'التعديلات والملاحق' },
  people: { en: 'People', ar: 'الكوادر البشرية' },
  renewals: { en: 'Renewals & risks', ar: 'التجديدات والمخاطر' },
  suppliers: { en: 'Suppliers', ar: 'الموردون ومقاولو الباطن' },
  growth: { en: 'Growth', ar: 'فرص النمو' },
  opportunity: { en: 'Opportunity cost', ar: 'تكلفة الفرصة البديلة' },
};

/** Who holds the data a question still needs. */
export type QOwner = 'bd' | 'tenders' | 'finance' | 'hr' | 'contracts' | 'operations' | 'training';
export const OWNER_LABEL: Record<QOwner, Bi> = {
  bd: { en: 'BD', ar: 'تطوير الأعمال' },
  tenders: { en: 'Tenders', ar: 'المناقصات' },
  finance: { en: 'Finance', ar: 'الإدارة المالية' },
  hr: { en: 'HR', ar: 'الموارد البشرية' },
  contracts: { en: 'Contracts', ar: 'إدارة العقود' },
  operations: { en: 'Operations', ar: 'العمليات' },
  training: { en: 'Training', ar: 'التدريب' },
};

export interface CeoQuestion {
  id: string;
  group: QGroup;
  data: QData;
  /** The chart title. */
  q: Bi;
  /** Fixed note under the title: how to read it, or "Will show: …" while the data is missing. */
  note: Bi;
  /** What we still need (part / missing only). */
  missing?: Bi;
  who?: QOwner[];
}

const Q = (id: string, group: QGroup, data: QData, q: Bi, note: Bi, missing?: Bi, who?: QOwner[]): CeoQuestion =>
  ({ id, group, data, q, note, missing, who });

export const CEO_QUESTIONS: CeoQuestion[] = [
  // 1 — Our projects today
  Q('P1', 'projects', 'have',
    { en: 'What are our totals: number of projects, CSAs, TSAs and amendments?', ar: 'ما إجمالي أعدادنا: المشروعات، وعقود الخدمات المستمرة، وعقود الخدمات الفنية، والملاحق؟' },
    { en: 'A project is one contract line in the CSA & O&M status report. Amendments come from the report’s amendment column: a line marked only “Amend.” counts as one, so the real total may be higher.',
      ar: 'المشروع بندُ عقدٍ واحد في تقرير موقف عقود الخدمات والتشغيل والصيانة. تُستخرج الملاحق من عمود الملحق في التقرير، ويُحسب البند المكتوب أمامه «ملحق» دون رقم ملحقًا واحدًا؛ لذا قد يزيد العدد الفعلي.' }),
  Q('P2', 'projects', 'have',
    { en: 'How many projects are live, finishing soon, or closed?', ar: 'كم مشروعًا ساريًا، وكم مشروعًا يوشك على الانتهاء، وكم مشروعًا انتهى؟' },
    { en: 'Counted from today against each line’s end date: running = more than 90 days left; ending soon = 90 days or less; past its end date = the date has passed but the line is still in the report. Click a bar for the list.',
      ar: 'يُحسب من تاريخ اليوم وفق تاريخ انتهاء كل بند: الساري تبقّى له أكثر من 90 يومًا، والموشك على الانتهاء 90 يومًا أو أقل، أما المتجاوز فقد انقضى تاريخه وما زال مدرجًا في التقرير. اضغط أي شريط لعرض قائمته.' }),
  Q('P3', 'projects', 'part',
    { en: 'How many projects of each type (O&M, consultancy, staffing, studies…)?', ar: 'كم مشروعًا لدينا من كل نوع (تشغيل وصيانة، واستشارات، وتوفير كوادر، ودراسات...)؟' },
    { en: 'For now the type is the contract form on file (CSA, O&M, TSA, Farm-in). It switches to service types once the list of project types is agreed.',
      ar: 'يعتمد النوع حاليًا على صيغة العقد المسجلة (خدمات مستمرة، وتشغيل وصيانة، وخدمات فنية، ومشاركة)، ويتحول إلى أنواع الخدمات فور اعتماد قائمتها.' },
    { en: 'A project type for every project (decision D1)', ar: 'نوع خدمة محدد لكل مشروع' }, ['bd']),
  Q('P4', 'projects', 'have',
    { en: 'How many projects does each client give us?', ar: 'كم مشروعًا يسنده إلينا كل عميل؟' },
    { en: 'Contract lines per client in the CSA & O&M status report. Click a client to open its page.',
      ar: 'عدد بنود العقود لكل عميل في تقرير موقف عقود الخدمات والتشغيل والصيانة. اضغط اسم العميل لفتح صفحته.' }),
  Q('P5', 'projects', 'part',
    { en: 'How many projects do we have in each area (upstream, midstream / gas, downstream)?', ar: 'كم مشروعًا لدينا في كل قطاع (الاستكشاف والإنتاج، والغاز والنقل، والتكرير والبتروكيماويات)؟' },
    { en: 'Contract lines per area of the oil and gas chain. Until BD gives each project its area, a project takes its client’s main business (rule under the chart); a client that works across the chain is named under it.',
      ar: 'بنود العقود موزعةً على قطاعات صناعة البترول والغاز. وإلى أن تحدد إدارة تطوير الأعمال قطاع كل مشروع، يأخذ المشروع النشاط الرئيس لعميله (القاعدة أسفل الرسم)، ويُذكر أسفله العميل الذي يعمل في أكثر من قطاع.' },
    { en: 'An area for every project (decision D2)', ar: 'قطاع محدد لكل مشروع' }, ['bd']),
  Q('P6', 'projects', 'have',
    { en: 'Which projects are the biggest by contract value?', ar: 'ما أكبر مشروعاتنا من حيث قيمة العقد؟' },
    { en: 'Top 10 lines by ceiling — the most the client can pay under the contract, not money earned. Lines paid by the month or with no value on file are named under the chart.',
      ar: 'أكبر عشرة بنود وفق الحد الأقصى للعقد، أي أقصى ما يحق للعميل دفعه، لا ما حصّلناه فعلًا. وتُذكر أسفل الرسم البنود ذات القيمة الشهرية أو التي لم تُسجَّل لها قيمة.' }),
  Q('P7', 'projects', 'part',
    { en: 'How many new projects did we win, and how many bids did we lose, each quarter?', ar: 'كم مشروعًا جديدًا فزنا به، وكم عطاءً خسرناه، في كل ربع سنة؟' },
    { en: 'Bids won and lost in each quarter, from this app’s bid register, by the quarter of the decision, with the value won. A bid with no decision date is placed in the quarter it was last changed (rule under the chart).',
      ar: 'العطاءات الفائزة والخاسرة في كل ربع سنة من سجل العطاءات بهذا التطبيق، وفق ربع السنة الذي صدر فيه القرار، مع قيمة ما فزنا به. ويُدرَج العطاء الذي لم يُسجَّل تاريخ قراره في ربع السنة الذي عُدِّل فيه آخر مرة (القاعدة أسفل الرسم).' },
    { en: 'A decision date and value on every closed bid', ar: 'تاريخ القرار وقيمة كل عطاء مغلق' }, ['bd', 'tenders']),
  Q('P8', 'projects', 'part',
    { en: 'How many staff (manpower) do we have in total, and how many in each category (inspection, maintenance, operation…)?', ar: 'كم يبلغ إجمالي كوادرنا، وكم منها في كل فئة (التفتيش، والصيانة، والتشغيل...)؟' },
    { en: 'A total and a bar per staff category. Until HR sends the staff list, the total is worked out from billing and day rates (as in the People group) and split by fixed shares (rule under the chart).',
      ar: 'الإجمالي وشريط لكل فئة من فئات العاملين. وإلى أن ترسل الموارد البشرية قائمة العاملين، يُحسب الإجمالي من الفوترة والفئات اليومية (كما في مجموعة الكوادر البشرية) ويُوزَّع على الفئات بنسب ثابتة (القاعدة أسفل الرسم).' },
    { en: 'Staff list with a category for each person (decision D9)', ar: 'قائمة العاملين مع فئة كل منهم' }, ['hr']),

  // 2 — Money
  Q('M1', 'money', 'part',
    { en: 'What is the total contract value of each project?', ar: 'ما إجمالي قيمة العقد لكل مشروع؟' },
    { en: 'Every contract line’s ceiling, added up per client — the most the client can pay, not money earned. A line with no ceiling on file is given an assumed value until the real one arrives (rule under the chart). Click a client to open its page.',
      ar: 'مجموع الحد الأقصى لبنود العقود لكل عميل، أي أقصى ما يحق للعميل دفعه، لا ما حصّلناه فعلًا. ويُعطى البند الذي لا حد أقصى له قيمةً مفترضة إلى أن تصل قيمته الفعلية (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Contract value of the lines paid by the month or with no value on file', ar: 'قيمة العقد للبنود ذات القيمة الشهرية أو التي لم تُسجَّل لها قيمة' }, ['contracts']),
  Q('M2', 'money', 'part',
    { en: 'What should we be paid each quarter, and what did we actually invoice?', ar: 'ما المستحق لنا في كل ربع سنة، وكم أصدرنا فعلًا من فواتير؟' },
    { en: 'Per completed quarter: what the contract ceilings say we should be paid, against what we billed. Until Finance sends the billing plan and the invoices, both are worked out from the ceilings (rule under the chart).',
      ar: 'لكل ربع سنة مكتمل: المستحق لنا وفق الحدود القصوى للعقود، مقابل ما فوترناه. وإلى أن ترسل الإدارة المالية خطة الفوترة والفواتير، يُحسب الرقمان من الحدود القصوى (القاعدة أسفل الرسم).' },
    { en: 'Quarterly billing plan and invoices per project', ar: 'خطة الفوترة الربع سنوية وفواتير كل مشروع' }, ['finance']),
  Q('M3', 'money', 'part',
    { en: 'How much have we collected, how much is still owed to us, and for how long?', ar: 'كم حصّلنا، وكم ما زال مستحقًا لنا، ومنذ متى؟' },
    { en: 'Money owed to us today by age, and what we collected over the last 12 months. Until Finance sends collections and open invoices, both are worked out from the assumed billing and a fixed payment time (rule under the chart).',
      ar: 'المستحقات القائمة لنا اليوم موزعةً حسب عمرها، وما حصّلناه خلال الاثني عشر شهرًا الماضية. وإلى أن ترسل الإدارة المالية التحصيلات والفواتير غير المسددة، يُحسب الرقمان من الفوترة المفترضة ومدة سداد ثابتة (القاعدة أسفل الرسم).' },
    { en: 'Collections and open invoices', ar: 'التحصيلات والفواتير غير المسددة' }, ['finance']),
  Q('M4', 'money', 'part',
    { en: 'What does our own staff cost on each project (salaries and benefits)?', ar: 'كم تكلفنا كوادرنا في كل مشروع (رواتب ومزايا)؟' },
    { en: 'Own-staff cost (salaries and benefits) per project over the last 12 months, totals only. Until payroll totals arrive, it is worked out from billing with EPROM’s own price build-up (rule under the chart). Click a client to open its page.',
      ar: 'تكلفة كوادرنا (رواتب ومزايا) في كل مشروع خلال الاثني عشر شهرًا الماضية، بالإجماليات فقط. وإلى أن تصل إجماليات الرواتب، تُحسب من الفوترة وفق هيكل التسعير المعتمد في "إيبروم" (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Staff cost per project (payroll totals, no names)', ar: 'تكلفة العاملين لكل مشروع (إجماليات دون أسماء)' }, ['hr', 'finance']),
  Q('M5', 'money', 'part',
    { en: 'How much do we pay subcontractors on each project?', ar: 'كم ندفع لمقاولي الباطن في كل مشروع؟' },
    { en: 'Live supplier contracts at their current value, grouped by the client they serve. EPROM’s own needs are shown apart under the chart. A contract held in US dollars is converted at an assumed rate.',
      ar: 'عقود الموردين السارية بقيمتها الحالية، مجمّعة حسب العميل الذي تخدمه، وتظهر احتياجات "إيبروم" الداخلية منفصلةً أسفل الرسم. ويُحوَّل العقد المبرم بالدولار الأمريكي بسعر صرف مفترض.' },
    { en: 'Which supplier contract serves which project (today each is tied to a client only), and the dollar rate Finance books', ar: 'ربط كل عقد مورد بالمشروع الذي يخدمه (مربوط حاليًا بالعميل فقط)، وسعر الدولار المعتمد لدى الإدارة المالية' }, ['contracts', 'finance']),
  Q('M6', 'money', 'part',
    { en: 'How much do we spend on travel and transport for each project?', ar: 'كم ننفق على السفر والانتقالات في كل مشروع؟' },
    { en: 'Travel and transport cost per project over the last 12 months. Until Finance sends it, it is a fixed share of our own direct cost (rule under the chart). Click a client to open its page.',
      ar: 'تكلفة السفر والانتقالات في كل مشروع خلال الاثني عشر شهرًا الماضية. وإلى أن ترسلها الإدارة المالية، تُحسب نسبةً ثابتة من تكلفتنا المباشرة (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Travel and transport cost per project', ar: 'تكلفة السفر والانتقالات لكل مشروع' }, ['finance']),
  Q('M7', 'money', 'part',
    { en: 'How much do we pay in allowances (site, housing, per diem…) on each project?', ar: 'كم ندفع من بدلات (موقع، وسكن، وإعاشة...) في كل مشروع؟' },
    { en: 'Allowances paid per project over the last 12 months. Until HR and Finance send them, they are a fixed share of our own direct cost (rule under the chart). Click a client to open its page.',
      ar: 'البدلات المصروفة في كل مشروع خلال الاثني عشر شهرًا الماضية. وإلى أن ترسلها الموارد البشرية والإدارة المالية، تُحسب نسبةً ثابتة من تكلفتنا المباشرة (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Allowances paid per project', ar: 'البدلات المصروفة لكل مشروع' }, ['hr', 'finance']),
  Q('M8', 'money', 'part',
    { en: 'What is the total cost of each project (M4 to M7 added up)?', ar: 'ما التكلفة الإجمالية لكل مشروع (الكوادر، ومقاولو الباطن، والسفر، والبدلات)؟' },
    { en: 'Total direct cost per project over the last 12 months: subcontractors plus our own staff, allowances and travel. Subcontractors come from the live supplier contracts; the rest is assumed (rule under the chart). Click a client to open its page.',
      ar: 'إجمالي التكلفة المباشرة لكل مشروع خلال الاثني عشر شهرًا الماضية: مقاولو الباطن مضافًا إليهم كوادرنا وبدلاتها وسفرها. تُستمد تكلفة مقاولي الباطن من عقود الموردين السارية، ويُفترض الباقي (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Needs M4 to M7 first', ar: 'يتطلب بيانات بنود التكلفة الأربعة أولًا' }, ['finance']),
  Q('M9', 'money', 'part',
    { en: 'What is the profit on each project, and which ones lose money?', ar: 'ما ربح كل مشروع، وأي المشروعات يحقق خسارة؟' },
    { en: 'Profit per project over the last 12 months = billing − direct cost − head-office overhead; loss-makers first, in red. All three stay assumed until Finance sends invoices and costs (rule under the chart). Click a client to open its page.',
      ar: 'ربح كل مشروع خلال الاثني عشر شهرًا الماضية = الفوترة − التكلفة المباشرة − المصروفات العامة للمركز الرئيسي، والمشروعات الخاسرة أولًا باللون الأحمر. وتظل القيم الثلاث مفترضة إلى أن ترسل الإدارة المالية الفواتير والتكاليف (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Needs invoices (M2) and total cost (M8)', ar: 'يتطلب الفواتير والتكلفة الإجمالية لكل مشروع' }, ['finance']),
  Q('M10', 'money', 'part',
    { en: 'How much of each contract value have we already used?', ar: 'كم استهلكنا من قيمة كل عقد حتى الآن؟' },
    { en: 'How much of each ceiling we have billed so far, most used first. Until Finance sends the invoices to date, it is worked out from the time each contract has run (rule under the chart). Click a project to open its client’s page.',
      ar: 'نسبة ما فوترناه حتى اليوم من الحد الأقصى لكل عقد، بدءًا بالأعلى استهلاكًا. وإلى أن ترسل الإدارة المالية إجمالي الفواتير حتى اليوم، تُحسب النسبة من المدة التي انقضت من كل عقد (القاعدة أسفل الرسم). اضغط أي مشروع لفتح صفحة عميله.' },
    { en: 'Total invoiced to date per project', ar: 'إجمالي ما فُوتِر لكل مشروع حتى اليوم' }, ['finance']),
  Q('M11', 'money', 'part',
    { en: 'How much money comes in and goes out each quarter?', ar: 'كم يدخل إلينا من مال وكم يخرج في كل ربع سنة؟' },
    { en: 'Per completed quarter: cash in (clients paying our bills) against cash out (direct cost and overhead). Until Finance sends the real receipts and payments, both are assumed (rule under the chart).',
      ar: 'لكل ربع سنة مكتمل: المقبوضات (ما يسدده العملاء من فواتيرنا) مقابل المدفوعات (التكلفة المباشرة والمصروفات العامة). وإلى أن ترسل الإدارة المالية المقبوضات والمدفوعات الفعلية، يُفترض الرقمان (القاعدة أسفل الرسم).' },
    { en: 'Quarterly receipts and payments', ar: 'المقبوضات والمدفوعات الربع سنوية' }, ['finance']),

  // 3 — Changes & amendments
  Q('A1', 'amendments', 'part',
    { en: 'How many amendments has each project had?', ar: 'كم ملحقًا وُقِّع لكل مشروع؟' },
    { en: 'From the amendment column of the CSA & O&M status report, most first. A line marked only “Amend.” is assumed to have one. Click a project to open its client’s page.',
      ar: 'من عمود الملحق في تقرير موقف عقود الخدمات والتشغيل والصيانة، والأكثر أولًا. ويُفترض أن للبند المكتوب أمامه «ملحق» دون رقم ملحقًا واحدًا. اضغط أي مشروع لفتح صفحة عميله.' },
    { en: 'The real number of amendments for the lines marked “Amend.” with no number', ar: 'العدد الفعلي لملاحق البنود المكتوب أمامها «ملحق» دون رقم' }, ['contracts']),
  Q('A2', 'amendments', 'part',
    { en: 'How many amendments do we sign each quarter?', ar: 'كم ملحقًا نوقّع في كل ربع سنة؟' },
    { en: 'For now, the amendments to our supplier contracts — the only ones with dates on file — counted by the quarter they start in, over the last 8 quarters. Client-contract amendments join once their dates arrive.',
      ar: 'تعرض حاليًا ملاحق عقود موردينا، فهي وحدها المسجلة بتواريخها، محسوبةً وفق ربع السنة الذي يبدأ فيه كل ملحق خلال آخر ثمانية أرباع. وتنضم إليها ملاحق عقود العملاء فور وصول تواريخها.' },
    { en: 'The signature date of every client-contract amendment', ar: 'تاريخ توقيع كل ملحق من ملاحق عقود العملاء' }, ['contracts']),
  Q('A3', 'amendments', 'part',
    { en: 'How much has each project grown in value through amendments?', ar: 'كم زادت قيمة كل مشروع بفضل الملاحق؟' },
    { en: 'Top 10 by growth from the original value to today’s ceiling, in %. Until the original values arrive, growth is assumed from each project’s amendments, using how our own supplier amendments behave (rule under the chart).',
      ar: 'أعلى عشرة مشروعات في نسبة الزيادة من القيمة الأصلية إلى الحد الأقصى الحالي. وإلى أن تصل القيم الأصلية، تُفترض الزيادة من عدد ملاحق كل مشروع، قياسًا على سلوك ملاحق عقود موردينا (القاعدة أسفل الرسم).' },
    { en: 'The original contract value of every project', ar: 'القيمة الأصلية لعقد كل مشروع' }, ['contracts']),
  Q('A4', 'amendments', 'part',
    { en: 'How many months have amendments added to each project?', ar: 'كم شهرًا أضافت الملاحق إلى مدة كل مشروع؟' },
    { en: 'Top 10 by months added between the original end date and today’s end date. Until the original dates arrive, the months are assumed from each project’s amendments (rule under the chart).',
      ar: 'أعلى عشرة مشروعات في عدد الأشهر المضافة بين تاريخ الانتهاء الأصلي وتاريخ الانتهاء الحالي. وإلى أن تصل التواريخ الأصلية، تُفترض الأشهر من عدد ملاحق كل مشروع (القاعدة أسفل الرسم).' },
    { en: 'The original end date of every project', ar: 'تاريخ الانتهاء الأصلي لكل مشروع' }, ['contracts']),
  Q('A5', 'amendments', 'part',
    { en: 'Which projects keep getting extended without a new tender? (risk, and a chance to grow)', ar: 'أي المشروعات تتكرر إطالة مدتها دون طرح مناقصة جديدة؟ (خطر، وفرصة نمو أيضًا)' },
    { en: 'Projects ranked by time extensions. Until the real count arrives it is assumed from the amendments (rule under the chart). The tag marks a line whose end date moved later between the last two status reports — that part is real.',
      ar: 'المشروعات مرتبة حسب عدد ملاحق مد المدة، ويُفترض العدد من الملاحق إلى أن يصل العدد الفعلي (القاعدة أسفل الرسم). وتُميِّز العلامةُ البندَ الذي تأخر تاريخ انتهائه بين آخر تقريرين لموقف العقود، وهذه معلومة فعلية.' },
    { en: 'The number of time extensions per project, and whether each one went through a tender', ar: 'عدد ملاحق مد المدة لكل مشروع، وهل طُرح كل منها في مناقصة' }, ['contracts']),
  Q('A6', 'amendments', 'part',
    { en: 'Are amendments signed on time, or do we work without paper?', ar: 'هل تُوقَّع الملاحق في موعدها، أم نعمل دون سند تعاقدي؟' },
    { en: 'Days of work without a signed paper, per contract line, longest first: lines still running past their end date (still open), and end dates extended only after the old one had passed (seen between the two report copies). A line with amendments but no dates takes the median delay (rule under the chart). Click a line to open the client.',
      ar: 'أيام العمل دون سند موقَّع لكل بند عقد، بدءًا بالأطول: بنود مستمرة بعد تاريخ انتهائها (ما زالت مفتوحة)، وبنود مُدِّد تاريخ انتهائها بعد انقضاء التاريخ السابق (بالمقارنة بين نسختي التقرير). ويأخذ البند ذو الملاحق غير المؤرخة وسيطَ مدة التأخير (القاعدة أسفل الرسم). اضغط البند لفتح صفحة العميل.' },
    { en: 'Request date, signature date and work start date of each amendment', ar: 'تاريخ طلب كل ملحق وتاريخ توقيعه وتاريخ بدء العمل به' }, ['contracts']),

  // 4 — People
  Q('H1', 'people', 'part',
    { en: 'How many of our staff work on each project?', ar: 'كم من كوادرنا يعمل في كل مشروع؟' },
    { en: 'Staff per project, most first. Until HR sends the staff-to-project list, it is worked out from each project’s assumed billing and the client’s day rates (rule under the chart). Click a client to open its page.',
      ar: 'عدد العاملين في كل مشروع، بدءًا بالأكبر. وإلى أن ترسل الموارد البشرية قائمة توزيع العاملين على المشروعات، يُحسب العدد من الفوترة المفترضة لكل مشروع والفئات اليومية لعميله (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Staff-to-project list', ar: 'قائمة توزيع العاملين على المشروعات' }, ['hr']),
  Q('H2', 'people', 'part',
    { en: 'How many staff are on the bench (not on any project) today?', ar: 'كم من كوادرنا بلا مشروع اليوم؟' },
    { en: 'One number: staff not placed on any project today, against all our staff. Until HR sends the list, it is a fixed share of the staff counted in H1 (rule under the chart). What it costs us is in O4.',
      ar: 'رقم واحد: العاملون غير الموزعين على أي مشروع اليوم، مقارنةً بإجمالي كوادرنا. وإلى أن ترسل الموارد البشرية القائمة، يُحسب نسبةً ثابتة من العاملين المحسوبين في السؤال الأول من هذه المجموعة (القاعدة أسفل الرسم)، وتظهر تكلفتهم في سؤال الدخل الضائع.' },
    { en: 'Staff-to-project list', ar: 'قائمة توزيع العاملين على المشروعات' }, ['hr']),
  Q('H3', 'people', 'have',
    { en: 'How do our day rates compare with the market, by grade?', ar: 'كيف تقارن فئاتنا اليومية بالسوق لكل درجة وظيفية؟' },
    { en: 'The bar is our clients’ median day rate for each grade (EGP per man-day), the tick is the reference client and the % is the gap between them. Click a grade to see each client. The “market” here is our own clients’ rates.',
      ar: 'يمثل الشريط الفئة اليومية الوسيطة لعملائنا في كل درجة (بالجنيه لكل يوم عمل)، وتمثل العلامة العميل المرجعي، وتبيّن النسبة الفارق بينهما. اضغط أي درجة لعرض فئة كل عميل؛ فالسوق هنا هو أسعار عملائنا أنفسهم.' }),
  Q('H4', 'people', 'part',
    { en: 'What does each grade cost us compared with what the client pays for it?', ar: 'كم تكلفنا كل درجة وظيفية مقارنةً بما يدفعه العميل عنها؟' },
    { en: 'Per grade, senior first: the median day rate our clients pay (the whole bar) and what that man-day costs us (the hatched part). Until HR and Finance send the cost per grade, it is worked out with EPROM’s own price build-up (rule under the chart).',
      ar: 'لكل درجة، بدءًا بالأعلى: الفئة اليومية الوسيطة التي يدفعها عملاؤنا (الشريط كاملًا)، وتكلفة يوم العمل علينا (الجزء المظلل). وإلى أن ترسل الموارد البشرية والإدارة المالية تكلفة كل درجة، تُحسب وفق هيكل التسعير المعتمد في "إيبروم" (القاعدة أسفل الرسم).' },
    { en: 'Average cost per grade (no names)', ar: 'متوسط التكلفة لكل درجة (دون أسماء)' }, ['hr', 'finance']),
  Q('H5', 'people', 'part',
    { en: 'Which projects depend on one key person?', ar: 'أي المشروعات يعتمد على شخص واحد لا بديل له؟' },
    { en: 'Projects small enough to hang on one person, smallest first. Until the project managers name them, a project counts when its assumed staff (H1) is very small (rule under the chart). Click a client to open its page.',
      ar: 'المشروعات الصغيرة التي قد يتوقف سيرها على شخص واحد، بدءًا بالأصغر. وإلى أن يحددها مديرو المشروعات، يُدرَج المشروع متى قلّ عدد العاملين المفترض فيه قلةً شديدة (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Project managers to flag them', ar: 'أن يحددها مديرو المشروعات' }, ['operations']),
  Q('H6', 'people', 'part',
    { en: 'Which positions are we failing to fill on time?', ar: 'أي الوظائف نتأخر في شغلها؟' },
    { en: 'Open positions per project and how long they have been open. Until HR sends the vacancy list, both are a fixed rule on the staff counted in H1 (rule under the chart). Click a client to open its page.',
      ar: 'الوظائف الشاغرة في كل مشروع ومدة شغورها. وإلى أن ترسل الموارد البشرية قائمة الوظائف الشاغرة، يُحسب الرقمان بقاعدة ثابتة من العاملين المحسوبين في السؤال الأول من هذه المجموعة (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Vacancy list per project', ar: 'قائمة الوظائف الشاغرة لكل مشروع' }, ['hr']),

  // 5 — Renewals & risks
  Q('R1', 'renewals', 'have',
    { en: 'Which contracts end in the next 30, 90 and 180 days?', ar: 'أي العقود تنتهي خلال 30 و90 و180 يومًا القادمة؟' },
    { en: 'Client contract lines counted by days left from today. Click a bar to open its list; click a line to open the client.', ar: 'بنود عقود العملاء مصنفة حسب الأيام المتبقية من اليوم. اضغط أي شريط لفتح قائمته، ثم اضغط البند لفتح صفحة العميل.' }),
  Q('R2', 'renewals', 'have',
    { en: 'Which contracts are already past their end date and still running?', ar: 'أي العقود تجاوزت تاريخ انتهائها وما زال العمل فيها مستمرًا؟' },
    { en: 'Lines whose end date has passed but are still in the report. Each one needs a renewal or an amendment on paper.', ar: 'بنود انقضى تاريخها وما زالت مدرجة في التقرير، ويحتاج كل منها إلى تجديد أو ملحق موثق.' }),
  Q('R3', 'renewals', 'part',
    { en: 'Which supplier contracts end before the client contract they support?', ar: 'أي عقود الموردين تنتهي قبل عقد العميل الذي تخدمه؟' },
    { en: 'Live supplier contracts matched to their client’s contract; those that end first are listed, soonest first. The bar is the months the client contract runs on without the supplier.', ar: 'نطابق عقود الموردين السارية مع عقد العميل الذي تخدمه، ونعرض ما ينتهي منها قبله بدءًا بالأقرب. يمثل الشريط عدد الأشهر التي يستمر فيها عقد العميل دون المورد.' },
    { en: 'Which supplier serves which project', ar: 'ربط كل مورد بالمشروع الذي يخدمه' }, ['contracts']),
  Q('R4', 'renewals', 'part',
    { en: 'Which projects have the most open risks?', ar: 'أي المشروعات تحمل أكبر عدد من المخاطر المفتوحة؟' },
    { en: 'Open risks per project, most first, with what they are. Until Operations sends the risk log, a risk is a warning sign read from our own contract rows (rule under the chart). Click a client to open its page.',
      ar: 'المخاطر المفتوحة في كل مشروع، بدءًا بالأكثر، مع بيان كل منها. وإلى أن ترسل إدارة العمليات سجل المخاطر، يُعدّ خطرًا كلُّ مؤشر إنذار يظهر في بيانات عقودنا (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Risk log per project', ar: 'سجل المخاطر لكل مشروع' }, ['operations']),
  Q('R5', 'renewals', 'part',
    { en: 'Which bank guarantees and bonds expire soon?', ar: 'أي خطابات الضمان والكفالات تنتهي قريبًا؟' },
    { en: 'Guarantees by time left to expiry, in value. Until Finance sends the guarantee list, each contract line is given one, sized and dated from its ceiling and end date (rule under the chart). Click a window for its lines.',
      ar: 'خطابات الضمان حسب المدة المتبقية على انتهائها، بقيمتها. وإلى أن ترسل الإدارة المالية قائمة خطابات الضمان، يُفترض لكل بند عقد خطابٌ تُحدَّد قيمته وتاريخه من الحد الأقصى للبند وتاريخ انتهائه (القاعدة أسفل الرسم). اضغط أي مدة لعرض بنودها.' },
    { en: 'Guarantee list with expiry dates', ar: 'قائمة خطابات الضمان بتواريخ انتهائها' }, ['finance']),

  // 6 — Suppliers
  Q('S1', 'suppliers', 'have',
    { en: 'How much do we spend through subcontractors, and with whom?', ar: 'كم ننفق عبر مقاولي الباطن، ومع من؟' },
    { en: 'Live supplier contracts at their current value, by contractor. A contract in US dollars is converted at an assumed rate; any other currency is left out.', ar: 'عقود الموردين السارية بقيمتها الحالية حسب المقاول. نحوّل العقد المبرم بالدولار الأمريكي بسعر صرف مفترض، ونستبعد العقود المبرمة بأي عملة أخرى.' }),
  Q('S2', 'suppliers', 'have',
    { en: 'Which supplier contracts grew the most through amendments?', ar: 'أي عقود الموردين زادت قيمتها أكثر من غيرها بفضل الملاحق؟' },
    { en: 'Top 10 live EGP contracts by growth from the value when signed to the current value.', ar: 'أعلى عشرة عقود سارية بالجنيه في نسبة الزيادة من قيمة التوقيع إلى القيمة الحالية.' }),
  Q('S3', 'suppliers', 'have',
    { en: 'Do we rely too much on one supplier?', ar: 'هل نعتمد على مورد واحد أكثر من اللازم؟' },
    { en: 'Share of live supplier spend held by the top 5 contractors, and by all the others together.', ar: 'حصة أكبر خمسة مقاولين من إنفاقنا على عقود الموردين السارية، مقابل حصة بقية المقاولين مجتمعين.' }),

  // 7 — Growth
  Q('G1', 'growth', 'part',
    { en: 'Where can we offer the client more services on a project we already run?', ar: 'أين يمكننا تقديم خدمات إضافية للعميل في مشروع نديره بالفعل؟' },
    { en: 'Per client, the services on our list it does not buy from us yet, the most first. Click a client to open its page.', ar: 'لكل عميل، الخدمات المدرجة في قائمة "إيبروم" التي لم يشترها منا بعد، بدءًا بأكثر العملاء فرصًا. اضغط اسم العميل لفتح صفحته.' },
    { en: 'Services list per client', ar: 'قائمة الخدمات المقدمة لكل عميل' }, ['bd']),
  Q('G2', 'growth', 'part',
    { en: 'What is in the pipeline (bids out, chance of winning, value)?', ar: 'ما الفرص المتاحة (العطاءات المقدمة، وفرص الفوز، والقيمة)؟' },
    { en: 'Open bids in this app’s bid register, by stage from first to last, with their value and their value weighted by the chance of winning. A bid with no chance typed in takes its stage’s (rule under the chart).',
      ar: 'العطاءات المفتوحة في سجل العطاءات بهذا التطبيق، حسب مرحلتها من الأولى إلى الأخيرة، بقيمتها وبقيمتها المرجّحة بفرصة الفوز. ويأخذ العطاء الذي لم تُسجَّل فرصة فوزه فرصةَ مرحلته (القاعدة أسفل الرسم).' },
    { en: 'A win chance on every open bid', ar: 'فرصة فوز مسجلة لكل عطاء مفتوح' }, ['bd']),
  Q('G3', 'growth', 'part',
    { en: 'Which clients bring the most income for each staff-day we spend on them?', ar: 'أي العملاء يحقق أعلى دخل لكل يوم عمل نبذله معه؟' },
    { en: 'Income per staff-day per client, highest first. Until Finance and HR send income and staff-days, it is the client’s average day rate on the rate sheet (rule under the chart). Click a client to open its page.',
      ar: 'الدخل لكل يوم عمل لدى كل عميل، بدءًا بالأعلى. وإلى أن ترسل الإدارة المالية والموارد البشرية الدخل وأيام العمل، يُحسب من متوسط الفئات اليومية للعميل في كشف الفئات (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Income and staff-days per client', ar: 'الدخل وأيام العمل لكل عميل' }, ['finance', 'hr']),
  Q('G4', 'growth', 'part',
    { en: 'Which clients have not given us new work in 12 months?', ar: 'أي العملاء لم يسند إلينا عملًا جديدًا منذ 12 شهرًا؟' },
    { en: 'Clients whose newest work with us started 12 months ago or more, the longest first. Click a client to open its page.', ar: 'العملاء الذين بدأ أحدث عمل لهم معنا قبل 12 شهرًا أو أكثر، بدءًا بالأطول انقطاعًا. اضغط اسم العميل لفتح صفحته.' },
    { en: 'Start date of each client contract', ar: 'تاريخ بدء كل عقد من عقود العملاء' }, ['bd']),

  // 8 — Opportunity cost
  Q('O1', 'opportunity', 'part',
    { en: 'How many of our staff are at each competency level?', ar: 'كم من كوادرنا في كل مستوى من مستويات الكفاءة؟' },
    { en: 'Staff per competency level, top level first. Until HR sends each person’s level, all our staff (People group) are spread over the rate sheet’s levels as a pyramid (rule under the chart).',
      ar: 'عدد العاملين في كل مستوى كفاءة، بدءًا بالأعلى. وإلى أن ترسل الموارد البشرية مستوى كل شخص، يُوزَّع إجمالي كوادرنا (مجموعة الكوادر البشرية) على مستويات كشف الفئات توزيعًا هرميًا (القاعدة أسفل الرسم).' },
    { en: 'Competency level for each person (from the Competency Management System assessments)', ar: 'مستوى الكفاءة لكل شخص (من تقييمات منظومة إدارة الكفاءات)' }, ['hr', 'training']),
  Q('O2', 'opportunity', 'part',
    { en: 'What is each competency level worth per day (what a client pays for it)?', ar: 'كم يساوي كل مستوى كفاءة في اليوم (ما يدفعه العميل عنه)؟' },
    { en: 'The median day rate clients pay for each competency level, with the lowest and highest, in EGP per man-day.', ar: 'الفئة اليومية الوسيطة التي يدفعها العملاء عن كل مستوى كفاءة، مع أدناها وأعلاها، بالجنيه لكل يوم عمل.' },
    { en: 'Each grade matched to a competency level', ar: 'ربط كل درجة وظيفية بمستوى كفاءة' }, ['hr', 'bd']),
  Q('O3', 'opportunity', 'part',
    { en: 'What is each person worth per year at their competency level?', ar: 'كم يساوي كل شخص في السنة وفق مستوى كفاءته؟' },
    { en: 'Per competency level: what one person earns in a year at that level’s day rate, and how many staff sit there. Names for the CEO only, once the levels arrive; until then the levels are O1’s (rule under the chart).',
      ar: 'لكل مستوى كفاءة: ما يحققه الشخص الواحد في السنة وفق الفئة اليومية لمستواه، وعدد العاملين فيه. والأسماء للرئيس التنفيذي وحده فور وصول المستويات، وإلى ذلك الحين تُعتمد مستويات السؤال الأول من هذه المجموعة (القاعدة أسفل الرسم).' },
    { en: 'Competency level and billable days for each person', ar: 'مستوى الكفاءة وأيام العمل القابلة للفوترة لكل شخص' }, ['hr']),
  Q('O4', 'opportunity', 'part',
    { en: 'How much income did we lose each quarter from unbilled staff-days (bench, waiting)?', ar: 'كم دخلًا خسرنا في كل ربع سنة بسبب أيام عمل لم تُفوتَر (انتظار أو بلا مشروع)؟' },
    { en: 'Income lost each completed quarter to staff-days nobody billed (bench, waiting). Until timesheets arrive, the bench is H2’s fixed share, billing at the same day rates as the staff placed (rule under the chart).',
      ar: 'الدخل الضائع في كل ربع سنة مكتمل بسبب أيام عمل لم تُفوتَر (انتظار أو بلا مشروع). وإلى أن تصل سجلات الحضور، يُحسب العاملون بلا مشروع بالنسبة الثابتة المعتمدة في مجموعة الكوادر البشرية، وكأنهم يُفوتَرون بالفئات اليومية نفسها للعاملين في المشروعات (القاعدة أسفل الرسم).' },
    { en: 'Billable vs available days for each person (timesheets)', ar: 'أيام العمل المفوترة مقابل المتاحة لكل شخص (سجلات الحضور)' }, ['hr', 'operations']),
  Q('O5', 'opportunity', 'part',
    { en: 'How much income do we lose by placing staff below their competency level (e.g. an expert paid as a junior)?', ar: 'كم دخلًا نخسر حين نضع الكوادر في درجة أدنى من مستواها (خبير يُحاسَب كمبتدئ مثلًا)؟' },
    { en: 'Income lost over the last 12 months per project by placing staff one grade below their level. Until HR and Operations send each person’s level and grade, a fixed share of each project’s staff is taken as under-placed (rule under the chart). Click a client to open its page.',
      ar: 'الدخل الضائع خلال الاثني عشر شهرًا الماضية في كل مشروع بسبب وضع العاملين في درجة أدنى من مستواهم. وإلى أن ترسل الموارد البشرية وإدارة العمليات مستوى كل شخص ودرجته، تُعدّ نسبة ثابتة من العاملين في كل مشروع موضوعةً دون مستواها (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Each person’s competency level vs the grade the client pays for', ar: 'مستوى كفاءة كل شخص مقابل الدرجة التي يدفع العميل عنها' }, ['hr', 'operations']),
  Q('O6', 'opportunity', 'part',
    { en: 'What work did we turn down or lose because we had no qualified staff, and what was it worth?', ar: 'ما الأعمال التي رفضناها أو خسرناها لعدم توفر كوادر مؤهلة، وكم كانت قيمتها؟' },
    { en: 'Value of the work turned down for lack of qualified staff, per completed quarter. Until BD logs the reason for each request, every bid marked “No Bid” in this app’s bid register counts (rule under the chart).',
      ar: 'قيمة الأعمال التي رفضناها لعدم توفر كوادر مؤهلة، في كل ربع سنة مكتمل. وإلى أن تسجل إدارة تطوير الأعمال سبب كل طلب، يُحتسب كل عطاء مسجل بحالة «عدم التقدم» في سجل العطاءات بهذا التطبيق (القاعدة أسفل الرسم).' },
    { en: 'Log of turned-down or lost requests with the reason', ar: 'سجل الطلبات المرفوضة أو الضائعة مع سبب كل منها' }, ['bd', 'tenders']),
  Q('O7', 'opportunity', 'part',
    { en: 'What is our total opportunity cost each quarter?', ar: 'ما إجمالي تكلفة الفرصة البديلة في كل ربع سنة؟' },
    { en: 'One column per completed quarter in three parts: unbilled days (O4), staff placed below their level (O5) and work turned down (O6). Each part follows its own rule until its data arrives.',
      ar: 'عمود لكل ربع سنة مكتمل من ثلاثة أجزاء: الأيام غير المفوترة، والعاملون الموضوعون دون مستواهم، والأعمال المرفوضة. ويتبع كل جزء قاعدته إلى أن تصل بياناته.' },
    { en: 'The data behind O4, O5 and O6', ar: 'بيانات الأسئلة الثلاثة السابقة' }, ['finance', 'bd']),
];

/** One language's text. */
export const pick = (b: Bi | undefined, ar: boolean): string => (b ? (ar ? b.ar : b.en) : '');

export const questionsIn = (g: QGroup, list: CeoQuestion[] = CEO_QUESTIONS) => list.filter(q => q.group === g);
