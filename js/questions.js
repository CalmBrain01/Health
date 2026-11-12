/* Somatic Odyssey research proforma: question bank, scales and helpers.
   Edit this file to change wording, options or where records are sent. */
(function () {
  'use strict';

  const SO = (window.SO = window.SO || {});

  /* Finished records are POSTed here as JSON. */
  SO.ENDPOINT = 'https://formboost.app/f/d2x2z8vr';

  /* ---------- shared helpers ---------- */
  SO.num = (v) => {
    const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  SO.fmt = (v) => SO.num(v).toLocaleString();
  SO.has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  SO.niceDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  SO.durationMonths = (a) => {
    if (!SO.has(a.durationValue)) return null;
    const n = SO.num(a.durationValue);
    return Math.round(a.durationUnit === 'Years' ? n * 12 : n);
  };
  SO.durationText = (a) => {
    if (!SO.has(a.durationValue)) return '';
    const n = SO.num(a.durationValue);
    const unit = (a.durationUnit || 'Months').toLowerCase();
    return `${SO.fmt(n)} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
  };

  /* ---------- sections (as on the printed proforma) ---------- */
  SO.SECTIONS = [
    { id: 'profile', letter: 'A', name: 'Profile', title: 'Sociodemographic and clinical profile' },
    {
      id: 'odyssey', letter: 'B', name: 'Odyssey', title: 'Healthcare odyssey and utilization',
      hint: 'Ask the patient. These questions cover care received before today’s psychiatric consultation.',
    },
    {
      id: 'scales', letter: 'C', name: 'Scales', title: 'Standardized psychometric assessments',
      hint: 'Read each item aloud and record the patient’s answer.',
    },
    { id: 'diagnosis', letter: 'D', name: 'Diagnosis', title: 'Final psychiatric diagnosis and disposition' },
  ];

  /* Captured on the start screen. */
  SO.RECORD_FIELDS = [
    { key: 'studyId', label: 'Patient study ID', input: 'text', required: true, placeholder: 'e.g. SO-014' },
    { key: 'crNo', label: 'Hospital CR no.', input: 'text' },
    { key: 'evalDate', label: 'Date of evaluation', input: 'date', required: true, default: 'today' },
    { key: 'interviewer', label: 'Interviewer name', input: 'text', required: true },
  ];

  /* ---------- standardized scales ---------- */
  const OFTEN = [
    { value: 0, label: 'Not at all' },
    { value: 1, label: 'Several days' },
    { value: 2, label: 'More than half the days' },
    { value: 3, label: 'Nearly every day' },
  ];

  SO.SCALES = {
    phq15: {
      name: 'PHQ-15',
      title: 'Somatic Symptom Severity Scale (PHQ-15)',
      stem: 'Over the last 4 weeks, how much have you been bothered by:',
      options: [
        { value: 0, label: 'Not bothered at all' },
        { value: 1, label: 'Bothered a little' },
        { value: 2, label: 'Bothered a lot' },
      ],
      max: 30,
      bands: [
        { min: 0, max: 4, label: 'Minimal', tone: 'ok' },
        { min: 5, max: 9, label: 'Low', tone: 'low' },
        { min: 10, max: 14, label: 'Medium', tone: 'mid' },
        { min: 15, max: 30, label: 'High', tone: 'high' },
      ],
      items: [
        ['a', 'Stomach pain'],
        ['b', 'Back pain'],
        ['c', 'Pain in your arms, legs, or joints (knees, hips, etc.)', 'Pain in arms, legs, or joints'],
        ['d', 'Menstrual cramps or other problems with your periods', 'Menstrual cramps or period problems'],
        ['e', 'Headaches'],
        ['f', 'Chest pain'],
        ['g', 'Dizziness'],
        ['h', 'Fainting spells'],
        ['i', 'Feeling your heart pound or race', 'Palpitations'],
        ['j', 'Shortness of breath'],
        ['k', 'Pain or problems during sexual intercourse', 'Pain or problems during intercourse'],
        ['l', 'Constipation, loose bowels, or diarrhea'],
        ['m', 'Nausea, gas, or indigestion'],
        ['n', 'Feeling tired or having low energy'],
        ['o', 'Trouble sleeping'],
      ],
    },
    phq9: {
      name: 'PHQ-9',
      title: 'Depression Severity Scale (PHQ-9)',
      stem: 'Over the last 2 weeks, how often have you been bothered by:',
      options: OFTEN,
      max: 27,
      bands: [
        { min: 0, max: 4, label: 'Minimal', tone: 'ok' },
        { min: 5, max: 9, label: 'Mild', tone: 'low' },
        { min: 10, max: 14, label: 'Moderate', tone: 'mid' },
        { min: 15, max: 19, label: 'Moderately severe', tone: 'high' },
        { min: 20, max: 27, label: 'Severe', tone: 'severe' },
      ],
      items: [
        ['a', 'Little interest or pleasure in doing things'],
        ['b', 'Feeling down, depressed, or hopeless'],
        ['c', 'Trouble falling or staying asleep, or sleeping too much', 'Sleep problems'],
        ['d', 'Feeling tired or having little energy'],
        ['e', 'Poor appetite or overeating'],
        ['f', 'Feeling bad about yourself, or that you are a failure or have let yourself or your family down', 'Feeling bad about yourself or a failure'],
        ['g', 'Trouble concentrating on things, such as reading the newspaper or watching television', 'Trouble concentrating'],
        ['h', 'Moving or speaking so slowly that other people could have noticed, or the opposite: being so fidgety or restless that you have been moving around a lot more than usual', 'Psychomotor slowing or restlessness'],
        ['i', 'Thoughts that you would be better off dead, or of hurting yourself in some way', 'Thoughts of death or self-harm'],
      ],
    },
    gad7: {
      name: 'GAD-7',
      title: 'Generalized Anxiety Disorder Scale (GAD-7)',
      stem: 'Over the last 2 weeks, how often have you been bothered by:',
      options: OFTEN,
      max: 21,
      bands: [
        { min: 0, max: 4, label: 'Minimal', tone: 'ok' },
        { min: 5, max: 9, label: 'Mild', tone: 'low' },
        { min: 10, max: 14, label: 'Moderate', tone: 'mid' },
        { min: 15, max: 21, label: 'Severe', tone: 'severe' },
      ],
      items: [
        ['a', 'Feeling nervous, anxious, or on edge'],
        ['b', 'Not being able to stop or control worrying'],
        ['c', 'Worrying too much about different things'],
        ['d', 'Trouble relaxing'],
        ['e', 'Being so restless that it is hard to sit still'],
        ['f', 'Becoming easily annoyed or irritable'],
        ['g', 'Feeling afraid, as if something awful might happen'],
      ],
    },
  };

  /* ---------- question builders ---------- */
  const choices = (labels) => labels.map((label) => ({ value: label, label }));
  const count = (key, label) => ({ key, label, input: 'number', min: 0, integer: true, zero: true, placeholder: '0' });
  const { fmt, has } = SO;

  const profile = [
    {
      id: 'age', ref: 'A1', short: 'Age', type: 'fields',
      prompt: 'How old is the patient?',
      fields: [{ key: 'age', label: 'Age in years', input: 'number', min: 1, max: 120, integer: true, required: true, size: 's' }],
      format: (a) => (has(a.age) ? `${a.age} years` : ''),
    },
    {
      id: 'gender', ref: 'A2', short: 'Gender',
      prompt: 'What is the patient’s gender?',
      options: choices(['Male', 'Female', 'Other']),
    },
    {
      id: 'marital', ref: 'A3', short: 'Marital status',
      prompt: 'What is the patient’s marital status?',
      options: choices(['Single', 'Married', 'Divorced or separated', 'Widowed']),
    },
    {
      id: 'education', ref: 'A4', short: 'Education level',
      prompt: 'What is the highest level of education the patient has completed?',
      options: choices(['Illiterate', 'Primary or middle school', 'High school', 'Graduate', 'Post-graduate']),
    },
    {
      id: 'employment', ref: 'A5', short: 'Employment status',
      prompt: 'What is the patient’s employment status?',
      options: choices(['Employed (full or part-time)', 'Unemployed', 'Homemaker', 'Retired']),
    },
    {
      id: 'income', ref: 'A6', short: 'Monthly family income', type: 'fields',
      prompt: 'What is the monthly family income?',
      fields: [
        { key: 'incomeAmount', label: 'Amount', input: 'number', min: 0, required: true },
        { key: 'incomeCurrency', label: 'Currency or local unit', input: 'text', placeholder: 'e.g. INR', size: 's' },
      ],
      format: (a) => (has(a.incomeAmount) ? `${fmt(a.incomeAmount)} ${a.incomeCurrency || ''}`.trim() : ''),
    },
    {
      id: 'complaint', ref: 'A7', short: 'Primary somatic complaint',
      prompt: 'What is the primary presenting somatic complaint?',
      options: [
        ...choices([
          'Chronic headache',
          'Generalized body aches or myalgia',
          'Chronic fatigue',
          'Gastrointestinal complaints or dyspepsia',
          'Multiple or vague somatic complaints',
        ]),
        { value: 'Other', label: 'Other', followUp: { key: 'complaintOther', label: 'Other complaint', input: 'text', required: true } },
      ],
    },
    {
      id: 'duration', ref: 'A8', short: 'Duration of somatic symptoms', type: 'fields',
      prompt: 'How long has the patient had these somatic symptoms?',
      fields: [
        { key: 'durationValue', label: 'Duration', input: 'number', min: 0, required: true, size: 's' },
        { key: 'durationUnit', label: 'Unit', input: 'chips', options: ['Months', 'Years'], default: 'Months', required: true },
      ],
      format: (a) => SO.durationText(a),
    },
  ];

  const odyssey = [
    {
      id: 'doctors', ref: 'B1', short: 'Doctors consulted',
      prompt: 'How many different doctors or specialists did you consult for these physical complaints before coming to psychiatry?',
      note: 'Past 12 months or the entire course of illness. Leave a box empty for none.',
      fields: [
        count('drGP', 'General practitioners or family doctors'),
        count('drMed', 'General medicine specialists'),
        count('drNeuro', 'Neurologists'),
        count('drOther', 'Other specialists (ENT, orthopedics, etc.)'),
      ],
      sum: { label: 'Total doctors visited' },
      format: (a, total) => (has(a.drGP)
        ? `${fmt(total)} in total: ${fmt(a.drGP)} family, ${fmt(a.drMed)} general medicine, ${fmt(a.drNeuro)} neurology, ${fmt(a.drOther)} other`
        : ''),
    },
    {
      id: 'tests', ref: 'B2', short: 'Investigations performed',
      prompt: 'How many medical investigations were ordered or performed for your physical symptoms?',
      note: 'Leave a box empty for none.',
      fields: [
        count('txLabs', 'Routine blood panels or labs'),
        count('txXray', 'X-rays or ultrasounds'),
        count('txCtMri', 'CT scan or MRI of brain or spine'),
        count('txEeg', 'EEG, ECG, or endoscopy'),
      ],
      sum: { label: 'Total tests done' },
      format: (a, total) => (has(a.txLabs)
        ? `${fmt(total)} in total: ${fmt(a.txLabs)} labs, ${fmt(a.txXray)} X-ray or ultrasound, ${fmt(a.txCtMri)} CT or MRI, ${fmt(a.txEeg)} EEG, ECG or endoscopy`
        : ''),
    },
    {
      id: 'er', ref: 'B3', short: 'Emergency visits',
      prompt: 'How many times did you visit the emergency department because of flare-ups of these physical complaints?',
      fields: [{ key: 'erVisits', label: 'Emergency or urgent care visits', input: 'number', min: 0, integer: true, required: true, size: 's' }],
      format: (a) => (has(a.erVisits) ? `${fmt(a.erVisits)} ${SO.num(a.erVisits) === 1 ? 'visit' : 'visits'}` : ''),
    },
    {
      id: 'cost', ref: 'B4', short: 'Out-of-pocket cost',
      prompt: 'Roughly how much have you spent out of pocket on consultation fees, tests, and travel for this care before today’s visit?',
      fields: [
        { key: 'costAmount', label: 'Total estimated cost', input: 'number', min: 0, required: true },
        { key: 'costCurrency', label: 'Currency or local unit', input: 'text', placeholder: 'e.g. INR', size: 's' },
      ],
      onEnter: (a) => { if (!has(a.costCurrency) && has(a.incomeCurrency)) a.costCurrency = a.incomeCurrency; },
      format: (a) => (has(a.costAmount) ? `${fmt(a.costAmount)} ${a.costCurrency || ''}`.trim() : ''),
    },
    {
      id: 'days', ref: 'B5', short: 'Days missed or impaired (6 months)',
      prompt: 'In the past 6 months, how many working or daily-activity days were missed or impaired because of these physical complaints?',
      fields: [{ key: 'daysImpaired', label: 'Days', input: 'number', min: 0, max: 183, integer: true, required: true, size: 's' }],
      format: (a) => (has(a.daysImpaired) ? `${fmt(a.daysImpaired)} days` : ''),
    },
    {
      id: 'priorDx', ref: 'B6', short: 'Previous diagnoses or treatments', type: 'choice',
      prompt: 'Were you given a specific medical diagnosis, or prescribed medicines that didn’t help?',
      note: 'For example migraine, neuralgia, cervical spondylosis, or gastritis; painkillers or vitamins.',
      options: [
        { value: 'Yes', label: 'Yes', followUp: { key: 'priorDxDetails', label: 'Diagnoses and medicines given', input: 'textarea', required: true } },
        { value: 'No', label: 'No' },
      ],
    },
  ];

  const diagnosis = [
    {
      id: 'dx', ref: 'D1', short: 'Primary psychiatric diagnosis', type: 'choice', aside: 'scores',
      prompt: 'What is the primary psychiatric diagnosis?',
      note: 'ICD-10 or DSM-5.',
      options: [
        {
          value: 'Depressive disorder', label: 'Depressive disorder',
          followUp: { key: 'dxSeverity', label: 'Depression severity', input: 'chips', options: ['Mild', 'Moderate', 'Severe'], required: true },
        },
        { value: 'Generalized anxiety disorder (GAD)', label: 'Generalized anxiety disorder (GAD)' },
        { value: 'Somatoform or somatic symptom disorder', label: 'Somatoform or somatic symptom disorder' },
        { value: 'Mixed anxiety and depressive disorder (MADD)', label: 'Mixed anxiety and depressive disorder (MADD)' },
        { value: 'Other', label: 'Other', followUp: { key: 'dxOther', label: 'Other diagnosis', input: 'text', required: true } },
      ],
    },
    {
      id: 'delay', ref: 'D2', short: 'Diagnostic delay', type: 'fields',
      prompt: 'How much time passed between the onset of physical symptoms and this psychiatric diagnosis?',
      note: 'Starts from the symptom duration recorded in A8. Adjust it if needed.',
      fields: [{ key: 'delayMonths', label: 'Months', input: 'number', min: 0, required: true, size: 's' }],
      onEnter: (a) => {
        if (!has(a.delayMonths)) {
          const m = SO.durationMonths(a);
          if (m !== null) a.delayMonths = String(m);
        }
      },
      format: (a) => (has(a.delayMonths) ? `${fmt(a.delayMonths)} months` : ''),
    },
    {
      id: 'plan', ref: 'D3', short: 'Management plan', type: 'multi', required: true,
      prompt: 'What is the management plan?',
      note: 'Select all that apply.',
      options: [
        { value: 'Pharmacotherapy (antidepressants or anxiolytics)', label: 'Start pharmacotherapy (antidepressants or anxiolytics)' },
        { value: 'Referral for psychological intervention or CBT', label: 'Refer for psychological intervention or CBT' },
        { value: 'Psychoeducation on mind–body connection and somatization', label: 'Psychoeducation on the mind–body connection and somatization' },
        {
          value: 'Follow-up scheduled', label: 'Schedule a follow-up',
          followUp: { key: 'followUpDate', label: 'Follow-up date', input: 'date', required: true },
        },
      ],
    },
    {
      id: 'sign', ref: 'D4', short: 'Investigator sign-off', type: 'fields',
      prompt: 'Sign off the record.',
      note: 'Type your name as the investigator’s signature.',
      fields: [
        { key: 'investigator', label: 'Investigator name', input: 'text', required: true },
        { key: 'signDate', label: 'Date', input: 'date', required: true, default: 'today' },
      ],
      format: (a) => (has(a.investigator) ? `${a.investigator}, ${SO.niceDate(a.signDate)}` : ''),
    },
  ];

  function scaleItems(scaleId, ref) {
    const sc = SO.SCALES[scaleId];
    return sc.items.map(([letter, text, short], i) => {
      const q = {
        id: `${scaleId}_${letter}`, section: 'scales', type: 'scale',
        scale: scaleId, letter, n: i + 1, ref: `${ref}${letter}`,
        prompt: text, short: short || text,
      };
      if (scaleId === 'phq15' && letter === 'd') {
        q.when = (a) => a.gender !== 'Male';
        q.allowNA = true;
      }
      if (scaleId === 'phq9' && letter === 'i') q.risk = true;
      return q;
    });
  }

  SO.QUESTIONS = [
    ...profile.map((q) => ({ section: 'profile', type: 'choice', ...q })),
    ...odyssey.map((q) => ({ section: 'odyssey', type: 'fields', ...q })),
    ...scaleItems('phq15', 'C1'),
    ...scaleItems('phq9', 'C2'),
    ...scaleItems('gad7', 'C3'),
    ...diagnosis.map((q) => ({ section: 'diagnosis', ...q })),
  ];
})();
