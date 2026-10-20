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
  Q('P5', 'projects', 'missing',
    { en: 'How many projects do we have in each area (upstream, midstream / gas, downstream)?', ar: 'كم مشروعًا لدينا في كل قطاع (الاستكشاف والإنتاج، والغاز والنقل، والتكرير والبتروكيماويات)؟' },
    { en: 'Will show: a donut of projects by area.', ar: 'سيعرض: حلقة توزّع المشروعات على القطاعات.' },
    { en: 'An area for every project (decision D2)', ar: 'قطاع محدد لكل مشروع' }, ['bd']),
  Q('P6', 'projects', 'have',
    { en: 'Which projects are the biggest by contract value?', ar: 'ما أكبر مشروعاتنا من حيث قيمة العقد؟' },
    { en: 'Top 10 lines by ceiling — the most the client can pay under the contract, not money earned. Lines paid by the month or with no value on file are named under the chart.',
      ar: 'أكبر عشرة بنود وفق الحد الأقصى للعقد، أي أقصى ما يحق للعميل دفعه، لا ما حصّلناه فعلًا. وتُذكر أسفل الرسم البنود ذات القيمة الشهرية أو التي لم تُسجَّل لها قيمة.' }),
  Q('P7', 'projects', 'missing',
    { en: 'How many new projects did we win, and how many bids did we lose, each quarter?', ar: 'كم مشروعًا جديدًا فزنا به، وكم عطاءً خسرناه، في كل ربع سنة؟' },
    { en: 'Will show: bids won vs lost per quarter.', ar: 'سيعرض: العطاءات الفائزة مقابل الخاسرة في كل ربع سنة.' },
    { en: 'Bid register with the result and value of each bid', ar: 'سجل العطاءات بنتيجة كل عطاء وقيمته' }, ['bd', 'tenders']),
  Q('P8', 'projects', 'missing',
    { en: 'How many staff (manpower) do we have in total, and how many in each category (inspection, maintenance, operation…)?', ar: 'كم يبلغ إجمالي كوادرنا، وكم منها في كل فئة (التفتيش، والصيانة، والتشغيل...)؟' },
    { en: 'Will show: a total tile and a bar per staff category.', ar: 'سيعرض: مربع الإجمالي، وشريطًا لكل فئة من فئات العاملين.' },
    { en: 'Staff list with a category for each person (decision D9)', ar: 'قائمة العاملين مع فئة كل منهم' }, ['hr']),

  // 2 — Money
  Q('M1', 'money', 'part',
    { en: 'What is the total contract value of each project?', ar: 'ما إجمالي قيمة العقد لكل مشروع؟' },
    { en: 'Every contract line’s ceiling, added up per client — the most the client can pay, not money earned. A line with no ceiling on file is given an assumed value until the real one arrives (rule under the chart). Click a client to open its page.',
      ar: 'مجموع الحد الأقصى لبنود العقود لكل عميل، أي أقصى ما يحق للعميل دفعه، لا ما حصّلناه فعلًا. ويُعطى البند الذي لا حد أقصى له قيمةً مفترضة إلى أن تصل قيمته الفعلية (القاعدة أسفل الرسم). اضغط اسم العميل لفتح صفحته.' },
    { en: 'Contract value of the lines paid by the month or with no value on file', ar: 'قيمة العقد للبنود ذات القيمة الشهرية أو التي لم تُسجَّل لها قيمة' }, ['contracts']),
  Q('M2', 'money', 'missing',
    { en: 'What should we be paid each quarter, and what did we actually invoice?', ar: 'ما المستحق لنا في كل ربع سنة، وكم أصدرنا فعلًا من فواتير؟' },
    { en: 'Will show: planned vs invoiced, by quarter.', ar: 'سيعرض: المخطط مقابل المُفوتَر في كل ربع سنة.' },
    { en: 'Quarterly billing plan and invoices per project', ar: 'خطة الفوترة الربع سنوية وفواتير كل مشروع' }, ['finance']),
  Q('M3', 'money', 'missing',
    { en: 'How much have we collected, how much is still owed to us, and for how long?', ar: 'كم حصّلنا، وكم ما زال مستحقًا لنا، ومنذ متى؟' },
    { en: 'Will show: money owed by age (0–30, 31–60, 61–90, over 90 days).', ar: 'سيعرض: المستحقات موزعة حسب عمرها (0–30، و31–60، و61–90، وأكثر من 90 يومًا).' },
    { en: 'Collections and open invoices', ar: 'التحصيلات والفواتير غير المسددة' }, ['finance']),
  Q('M4', 'money', 'missing',
    { en: 'What does our own staff cost on each project (salaries and benefits)?', ar: 'كم تكلفنا كوادرنا في كل مشروع (رواتب ومزايا)؟' },
    { en: 'Will show: own-staff cost per project, from payroll totals only — no names.', ar: 'سيعرض: تكلفة كوادرنا في كل مشروع، بإجماليات الرواتب فقط دون أسماء.' },
    { en: 'Staff cost per project (payroll totals, no names)', ar: 'تكلفة العاملين لكل مشروع (إجماليات دون أسماء)' }, ['hr', 'finance']),
  Q('M5', 'money', 'part',
    { en: 'How much do we pay subcontractors on each project?', ar: 'كم ندفع لمقاولي الباطن في كل مشروع؟' },
    { en: 'Live supplier contracts at their current value, grouped by the client they serve. EPROM’s own needs are shown apart under the chart. A contract held in US dollars is converted at an assumed rate.',
      ar: 'عقود الموردين السارية بقيمتها الحالية، مجمّعة حسب العميل الذي تخدمه، وتظهر احتياجات "إيبروم" الداخلية منفصلةً أسفل الرسم. ويُحوَّل العقد المبرم بالدولار الأمريكي بسعر صرف مفترض.' },
    { en: 'Which supplier contract serves which project (today each is tied to a client only), and the dollar rate Finance books', ar: 'ربط كل عقد مورد بالمشروع الذي يخدمه (مربوط حاليًا بالعميل فقط)، وسعر الدولار المعتمد لدى الإدارة المالية' }, ['contracts', 'finance']),
  Q('M6', 'money', 'missing',
    { en: 'How much do we spend on travel and transport for each project?', ar: 'كم ننفق على السفر والانتقالات في كل مشروع؟' },
    { en: 'Will show: travel and transport cost per project.', ar: 'سيعرض: تكلفة السفر والانتقالات لكل مشروع.' },
    { en: 'Travel and transport cost per project', ar: 'تكلفة السفر والانتقالات لكل مشروع' }, ['finance']),
  Q('M7', 'money', 'missing',
    { en: 'How much do we pay in allowances (site, housing, per diem…) on each project?', ar: 'كم ندفع من بدلات (موقع، وسكن، وإعاشة...) في كل مشروع؟' },
    { en: 'Will show: allowances paid per project.', ar: 'سيعرض: البدلات المصروفة لكل مشروع.' },
    { en: 'Allowances paid per project', ar: 'البدلات المصروفة لكل مشروع' }, ['hr', 'finance']),
  Q('M8', 'money', 'missing',
    { en: 'What is the total cost of each project (M4 to M7 added up)?', ar: 'ما التكلفة الإجمالية لكل مشروع (الكوادر، ومقاولو الباطن، والسفر، والبدلات)؟' },
    { en: 'Will show: one total bar per project, adding up the four costs above.', ar: 'سيعرض: شريطًا واحدًا لإجمالي كل مشروع يجمع بنود التكلفة الأربعة السابقة.' },
    { en: 'Needs M4 to M7 first', ar: 'يتطلب بيانات بنود التكلفة الأربعة أولًا' }, ['finance']),
  Q('M9', 'money', 'missing',
    { en: 'What is the profit on each project, and which ones lose money?', ar: 'ما ربح كل مشروع، وأي المشروعات يحقق خسارة؟' },
    { en: 'Will show: profit per project, loss-makers in red.', ar: 'سيعرض: ربح كل مشروع، والخاسر منها باللون الأحمر.' },
    { en: 'Needs invoices (M2) and total cost (M8)', ar: 'يتطلب الفواتير والتكلفة الإجمالية لكل مشروع' }, ['finance']),
  Q('M10', 'money', 'missing',
    { en: 'How much of each contract value have we already used?', ar: 'كم استهلكنا من قيمة كل عقد حتى الآن؟' },
    { en: 'Will show: a progress bar per project — invoiced to date against the ceiling.', ar: 'سيعرض: شريط تقدم لكل مشروع يقارن المُفوتَر حتى اليوم بالحد الأقصى.' },
    { en: 'Total invoiced to date per project', ar: 'إجمالي ما فُوتِر لكل مشروع حتى اليوم' }, ['finance']),
  Q('M11', 'money', 'missing',
    { en: 'How much money comes in and goes out each quarter?', ar: 'كم يدخل إلينا من مال وكم يخرج في كل ربع سنة؟' },
    { en: 'Will show: cash in vs cash out, by quarter.', ar: 'سيعرض: المقبوضات مقابل المدفوعات في كل ربع سنة.' },
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
  Q('A6', 'amendments', 'missing',
    { en: 'Are amendments signed on time, or do we work without paper?', ar: 'هل تُوقَّع الملاحق في موعدها، أم نعمل دون سند تعاقدي؟' },
    { en: 'Will show: days between work start and signature, per amendment.', ar: 'سيعرض: عدد الأيام بين بدء العمل وتوقيع الملحق، لكل ملحق.' },
    { en: 'Request date, signature date and work start date of each amendment', ar: 'تاريخ طلب كل ملحق وتاريخ توقيعه وتاريخ بدء العمل به' }, ['contracts']),

  // 4 — People
  Q('H1', 'people', 'missing',
    { en: 'How many of our staff work on each project?', ar: 'كم من كوادرنا يعمل في كل مشروع؟' },
    { en: 'Will show: staff count per project.', ar: 'سيعرض: عدد العاملين في كل مشروع.' },
    { en: 'Staff-to-project list', ar: 'قائمة توزيع العاملين على المشروعات' }, ['hr']),
  Q('H2', 'people', 'missing',
    { en: 'How many staff are on the bench (not on any project) today?', ar: 'كم من كوادرنا بلا مشروع اليوم؟' },
    { en: 'Will show: one number — staff not placed on any project today. What it costs us is in O4.', ar: 'سيعرض: رقمًا واحدًا لعدد العاملين غير الموزعين على أي مشروع اليوم، وتظهر تكلفتهم في سؤال الدخل الضائع.' },
    { en: 'Staff-to-project list', ar: 'قائمة توزيع العاملين على المشروعات' }, ['hr']),
  Q('H3', 'people', 'have',
    { en: 'How do our day rates compare with the market, by grade?', ar: 'كيف تقارن فئاتنا اليومية بالسوق لكل درجة وظيفية؟' },
    { en: 'EGP per man-day from the CSA day-rate sheet, against the reference client or the median client. The “market” here is our own clients’ rates.',
      ar: 'بالجنيه لكل يوم عمل من كشف الفئات اليومية لعقود الخدمات، مقارنةً بالعميل المرجعي أو بالوسيط بين العملاء؛ فالسوق هنا هو أسعار عملائنا أنفسهم.' }),
  Q('H4', 'people', 'missing',
    { en: 'What does each grade cost us compared with what the client pays for it?', ar: 'كم تكلفنا كل درجة وظيفية مقارنةً بما يدفعه العميل عنها؟' },
    { en: 'Will show: our cost vs the client’s day rate, per grade.', ar: 'سيعرض: تكلفتنا مقابل الفئة اليومية التي يدفعها العميل، لكل درجة.' },
    { en: 'Average cost per grade (no names)', ar: 'متوسط التكلفة لكل درجة (دون أسماء)' }, ['hr', 'finance']),
  Q('H5', 'people', 'missing',
    { en: 'Which projects depend on one key person?', ar: 'أي المشروعات يعتمد على شخص واحد لا بديل له؟' },
    { en: 'Will show: a list of projects with their key person.', ar: 'سيعرض: قائمة بالمشروعات والشخص المحوري في كل منها.' },
    { en: 'Project managers to flag them', ar: 'أن يحددها مديرو المشروعات' }, ['operations']),
  Q('H6', 'people', 'missing',
    { en: 'Which positions are we failing to fill on time?', ar: 'أي الوظائف نتأخر في شغلها؟' },
    { en: 'Will show: open positions by days open.', ar: 'سيعرض: الوظائف الشاغرة حسب عدد أيام شغورها.' },
    { en: 'Vacancy list per project', ar: 'قائمة الوظائف الشاغرة لكل مشروع' }, ['hr']),

  // 5 — Renewals & risks
  Q('R1', 'renewals', 'have',
    { en: 'Which contracts end in the next 30, 90 and 180 days?', ar: 'أي العقود تنتهي خلال 30 و90 و180 يومًا القادمة؟' },
    { en: 'Client contract lines counted by days left from today. Click a bucket for the list.', ar: 'بنود عقود العملاء مصنفة حسب الأيام المتبقية من اليوم، واضغط أي فئة لعرض قائمتها.' }),
  Q('R2', 'renewals', 'have',
    { en: 'Which contracts are already past their end date and still running?', ar: 'أي العقود تجاوزت تاريخ انتهائها وما زال العمل فيها مستمرًا؟' },
    { en: 'Lines whose end date has passed but are still in the report. Each one needs a renewal or an amendment on paper.', ar: 'بنود انقضى تاريخها وما زالت مدرجة في التقرير، ويحتاج كل منها إلى تجديد أو ملحق موثق.' }),
  Q('R3', 'renewals', 'part',
    { en: 'Which supplier contracts end before the client contract they support?', ar: 'أي عقود الموردين تنتهي قبل عقد العميل الذي تخدمه؟' },
    { en: 'Supplier contracts matched to the same client’s contract; those that end first are listed.', ar: 'تُطابَق عقود الموردين مع عقد العميل نفسه، ويظهر ما ينتهي منها قبل عقد العميل.' },
    { en: 'Which supplier serves which project', ar: 'ربط كل مورد بالمشروع الذي يخدمه' }, ['contracts']),
  Q('R4', 'renewals', 'missing',
    { en: 'Which projects have the most open risks?', ar: 'أي المشروعات تحمل أكبر عدد من المخاطر المفتوحة؟' },
    { en: 'Will show: open risks per project.', ar: 'سيعرض: عدد المخاطر المفتوحة لكل مشروع.' },
    { en: 'Risk log per project', ar: 'سجل المخاطر لكل مشروع' }, ['operations']),
  Q('R5', 'renewals', 'missing',
    { en: 'Which bank guarantees and bonds expire soon?', ar: 'أي خطابات الضمان والكفالات تنتهي قريبًا؟' },
    { en: 'Will show: guarantees by time left to expiry.', ar: 'سيعرض: خطابات الضمان حسب المدة المتبقية على انتهائها.' },
    { en: 'Guarantee list with expiry dates', ar: 'قائمة خطابات الضمان بتواريخ انتهائها' }, ['finance']),

  // 6 — Suppliers
  Q('S1', 'suppliers', 'have',
    { en: 'How much do we spend through subcontractors, and with whom?', ar: 'كم ننفق عبر مقاولي الباطن، ومع من؟' },
    { en: 'Live supplier contracts at their current value, by contractor. EGP only; contracts in another currency are left out.', ar: 'عقود الموردين السارية بقيمتها الحالية حسب المقاول، بالجنيه فقط، وتُستبعد العقود المبرمة بعملة أخرى.' }),
  Q('S2', 'suppliers', 'have',
    { en: 'Which supplier contracts grew the most through amendments?', ar: 'أي عقود الموردين زادت قيمتها أكثر من غيرها بفضل الملاحق؟' },
    { en: 'Top 10 live EGP contracts by growth from the value when signed to the current value.', ar: 'أعلى عشرة عقود سارية بالجنيه في نسبة الزيادة من قيمة التوقيع إلى القيمة الحالية.' }),
  Q('S3', 'suppliers', 'have',
    { en: 'Do we rely too much on one supplier?', ar: 'هل نعتمد على مورد واحد أكثر من اللازم؟' },
    { en: 'Share of live EGP supplier spend held by the top 5 contractors.', ar: 'حصة أكبر خمسة مقاولين من إنفاقنا على عقود الموردين السارية بالجنيه.' }),

  // 7 — Growth
  Q('G1', 'growth', 'part',
    { en: 'Where can we offer the client more services on a project we already run?', ar: 'أين يمكننا تقديم خدمات إضافية للعميل في مشروع نديره بالفعل؟' },
    { en: 'Services each client already buys, against EPROM’s full service list.', ar: 'الخدمات التي يشتريها كل عميل حاليًا مقارنةً بقائمة خدمات "إيبروم" كاملة.' },
    { en: 'Services list per client', ar: 'قائمة الخدمات المقدمة لكل عميل' }, ['bd']),
  Q('G2', 'growth', 'missing',
    { en: 'What is in the pipeline (bids out, chance of winning, value)?', ar: 'ما الفرص المتاحة (العطاءات المقدمة، وفرص الفوز، والقيمة)؟' },
    { en: 'Will show: bids by stage, as a funnel. Check the opportunities list in this app first.', ar: 'سيعرض: العطاءات حسب مرحلتها في شكل قمع، مع مراجعة قائمة الفرص في هذا التطبيق أولًا.' },
    { en: 'Pipeline list with stage, chance and value', ar: 'قائمة الفرص بمراحلها وفرص الفوز وقيمها' }, ['bd']),
  Q('G3', 'growth', 'missing',
    { en: 'Which clients bring the most income for each staff-day we spend on them?', ar: 'أي العملاء يحقق أعلى دخل لكل يوم عمل نبذله معه؟' },
    { en: 'Will show: income per staff-day, per client.', ar: 'سيعرض: الدخل لكل يوم عمل، لكل عميل.' },
    { en: 'Income and staff-days per client', ar: 'الدخل وأيام العمل لكل عميل' }, ['finance', 'hr']),
  Q('G4', 'growth', 'part',
    { en: 'Which clients have not given us new work in 12 months?', ar: 'أي العملاء لم يسند إلينا عملًا جديدًا منذ 12 شهرًا؟' },
    { en: 'Clients with the date their latest contract started.', ar: 'العملاء مع تاريخ بدء أحدث عقد لكل منهم.' },
    { en: 'Contract start dates (mostly in hand)', ar: 'تواريخ بدء العقود (أغلبها متاح)' }, ['bd']),

  // 8 — Opportunity cost
  Q('O1', 'opportunity', 'missing',
    { en: 'How many of our staff are at each competency level?', ar: 'كم من كوادرنا في كل مستوى من مستويات الكفاءة؟' },
    { en: 'Will show: staff count per competency level.', ar: 'سيعرض: عدد العاملين في كل مستوى كفاءة.' },
    { en: 'Competency level for each person (from the Competency Management System assessments)', ar: 'مستوى الكفاءة لكل شخص (من تقييمات منظومة إدارة الكفاءات)' }, ['hr', 'training']),
  Q('O2', 'opportunity', 'part',
    { en: 'What is each competency level worth per day (what a client pays for it)?', ar: 'كم يساوي كل مستوى كفاءة في اليوم (ما يدفعه العميل عنه)؟' },
    { en: 'Day rate per competency level, from the day-rate sheet once each grade is matched to a level.', ar: 'الفئة اليومية لكل مستوى كفاءة، من كشف الفئات اليومية بعد ربط كل درجة وظيفية بمستوى.' },
    { en: 'Each grade matched to a competency level', ar: 'ربط كل درجة وظيفية بمستوى كفاءة' }, ['hr', 'bd']),
  Q('O3', 'opportunity', 'missing',
    { en: 'What is each person worth per year at their competency level?', ar: 'كم يساوي كل شخص في السنة وفق مستوى كفاءته؟' },
    { en: 'Will show: staff count per yearly value band. Names for the CEO only.', ar: 'سيعرض: عدد العاملين في كل شريحة قيمة سنوية، والأسماء للرئيس التنفيذي وحده.' },
    { en: 'Competency level and billable days for each person', ar: 'مستوى الكفاءة وأيام العمل القابلة للفوترة لكل شخص' }, ['hr']),
  Q('O4', 'opportunity', 'missing',
    { en: 'How much income did we lose each quarter from unbilled staff-days (bench, waiting)?', ar: 'كم دخلًا خسرنا في كل ربع سنة بسبب أيام عمل لم تُفوتَر (انتظار أو بلا مشروع)؟' },
    { en: 'Will show: lost income by quarter = unbilled days × the day rate of each person’s level.', ar: 'سيعرض: الدخل الضائع في كل ربع سنة = الأيام غير المفوترة × الفئة اليومية لمستوى كل شخص.' },
    { en: 'Billable vs available days for each person (timesheets)', ar: 'أيام العمل المفوترة مقابل المتاحة لكل شخص (سجلات الحضور)' }, ['hr', 'operations']),
  Q('O5', 'opportunity', 'missing',
    { en: 'How much income do we lose by placing staff below their competency level (e.g. an expert paid as a junior)?', ar: 'كم دخلًا نخسر حين نضع الكوادر في درجة أدنى من مستواها (خبير يُحاسَب كمبتدئ مثلًا)؟' },
    { en: 'Will show: lost income per project = (rate of the person’s level − rate the client pays) × days worked.', ar: 'سيعرض: الدخل الضائع لكل مشروع = (فئة مستوى الشخص − الفئة التي يدفعها العميل) × أيام العمل.' },
    { en: 'Each person’s competency level vs the grade the client pays for', ar: 'مستوى كفاءة كل شخص مقابل الدرجة التي يدفع العميل عنها' }, ['hr', 'operations']),
  Q('O6', 'opportunity', 'missing',
    { en: 'What work did we turn down or lose because we had no qualified staff, and what was it worth?', ar: 'ما الأعمال التي رفضناها أو خسرناها لعدم توفر كوادر مؤهلة، وكم كانت قيمتها؟' },
    { en: 'Will show: value lost by quarter.', ar: 'سيعرض: القيمة الضائعة في كل ربع سنة.' },
    { en: 'Log of turned-down or lost requests with the reason', ar: 'سجل الطلبات المرفوضة أو الضائعة مع سبب كل منها' }, ['bd', 'tenders']),
  Q('O7', 'opportunity', 'missing',
    { en: 'What is our total opportunity cost each quarter?', ar: 'ما إجمالي تكلفة الفرصة البديلة في كل ربع سنة؟' },
    { en: 'Will show: one bar per quarter in 3 parts — unbilled days, under-placement and work turned down.', ar: 'سيعرض: عمودًا لكل ربع سنة من ثلاثة أجزاء: الأيام غير المفوترة، والتوزيع دون المستوى، والأعمال المرفوضة.' },
    { en: 'Needs O4, O5 and O6 first', ar: 'يتطلب بيانات الأسئلة الثلاثة السابقة أولًا' }, ['finance', 'bd']),
];

/** One language's text. */
export const pick = (b: Bi | undefined, ar: boolean): string => (b ? (ar ? b.ar : b.en) : '');

export const questionsIn = (g: QGroup, list: CeoQuestion[] = CEO_QUESTIONS) => list.filter(q => q.group === g);
