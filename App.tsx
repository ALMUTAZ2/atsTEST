import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeResume } from './geminiService.ts';
import { AnalysisResult, AppStatus } from './types.ts';
import {
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  ChevronRight,
  Search,
  Zap,
  RotateCcw,
  FileText,
  FileDown,
  Loader2,
  Download,
  ShieldAlert,
  Target,
  FileSearch,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import {
  ResponsiveContainer,
  Legend,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis
} from 'recharts';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import FileSaver from 'file-saver';

const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default || FileSaver;
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs`;

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_USAGE = 2; // حد الاستخدام لكل متصفح

export default function App() {
  const [resumeText, setResumeText] = useState('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string; tech?: string } | null>(null);
  const [usageCount, setUsageCount] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ================== SECTION HEADERS LOGIC ==================

  const SECTION_HEADERS = [
    'PROFESSIONAL SUMMARY',
    'SUMMARY',
    'EXPERIENCE',
    'WORK EXPERIENCE',
    'PROJECTS',
    'SKILLS',
    'TECHNICAL SKILLS',
    'EDUCATION',
    'CERTIFICATIONS',
    'LANGUAGES',
    'ADDITIONAL INFORMATION'
  ];

  const isSectionHeader = (line: string) => {
    const t = line.trim();
    if (!t) return false;
    const upper = t.toUpperCase();

    if (SECTION_HEADERS.includes(upper)) return true;

    // عنوان عام: كله كابيتال، مو بوليت، وطوله معقول
    if (upper === t && !t.startsWith('-') && t.length <= 60) return true;

    return false;
  };

  const renderResumeText = (text: string) => {
    return text.split('\n').map((line, idx) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        return <div key={idx} className="h-3" />;
      }

      if (isSectionHeader(line)) {
        return (
          <p
            key={idx}
            className="mt-5 mb-2 text-base font-extrabold text-slate-900 tracking-wide"
          >
            {trimmed.toUpperCase()}
          </p>
        );
      }

      return (
        <p key={idx} className="text-sm text-slate-700">
          {line}
        </p>
      );
    });
  };

  // ================== USAGE LIMIT (localStorage) ==================

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ats_usage_count');
      if (saved) {
        const num = Number(saved);
        if (!Number.isNaN(num)) {
          setUsageCount(num);
        }
      }
    } catch (e) {
      console.warn('Failed to read usage count from localStorage', e);
    }
  }, []);

  const incrementUsage = () => {
    setUsageCount(prev => {
      const next = prev + 1;
      try {
        localStorage.setItem('ats_usage_count', String(next));
      } catch (e) {
        console.warn('Failed to save usage count', e);
      }
      return next;
    });
  };

  // ================== HANDLERS ==================

  const handleProcess = async () => {
    if (!resumeText.trim()) return;

    // تحقق من الحد قبل الإرسال
    if (usageCount >= MAX_USAGE) {
      setError({
        message: 'Usage limit reached.',
        hint: 'You have already used the free ATS audit 2 times on this browser. Please upgrade your plan or use another account/device.',
        tech: 'USAGE_LIMIT_REACHED'
      });
      setStatus('error');
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setStatus('analyzing');
    setError(null);
    try {
      const data = await analyzeResume(resumeText, abortControllerRef.current.signal);
      setResult(data);

      // زيادة العداد بعد نجاح التحليل
      incrementUsage();

      setStatus('completed');
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) return;

      console.error('Audit processing failed:', err);

      let message = 'The Auditor encountered an issue.';
      let hint =
        'If this is your first time deploying, ensure you have set the VITE_API_KEY correctly in Vercel.';
      let tech = err.message || 'Unknown technical error';

      if (err.message === 'API_KEY_MISSING_IN_BROWSER') {
        message = 'Vercel Configuration Error';
        hint = "Add 'VITE_API_KEY' in Vercel Environment Variables, redeploy, and try again.";
      }

      setError({ message, hint, tech });
      setStatus('error');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatus('idle');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError({ message: 'File size exceeds 2MB limit.' });
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPDF(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        text = await extractTextFromDocx(file);
      } else if (file.type === 'text/plain') {
        text = await file.text();
      } else {
        throw new Error('Unsupported format. Please use PDF, DOCX, or TXT.');
      }
      if (!text.trim()) throw new Error('Could not extract meaningful text.');
      setResumeText(text);
    } catch (err: any) {
      setError({ message: err.message || 'Error reading file.' });
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as any[];
      const pageText = items.map((item) => item.str).join(' ');
      fullText += pageText + '\n\n';
    }
    return fullText;
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result.corrected_optimized_resume.plain_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ============ PDF EXPORT مع عناوين Bold ============

  const handleDownloadPDF = () => {
    if (!result) return;

    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - margin * 2;
    let y = margin;

    const lines = result.corrected_optimized_resume.plain_text.split('\n');

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        y += 4;
        return;
      }

      const ensureNewPage = () => {
        if (y > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
      };

      if (isSectionHeader(line)) {
        ensureNewPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        const headerText = trimmed.toUpperCase();
        doc.text(headerText, margin, y);
        y += 8;
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const wrapped = doc.splitTextToSize(line, usableWidth);
        wrapped.forEach((wLine: string) => {
          ensureNewPage();
          doc.text(wLine, margin, y);
          y += 5;
        });
      }
    });

    doc.save('ATS_Audited_Resume.pdf');
  };

  // ============ WORD EXPORT مع عناوين Bold ============

  const handleDownloadWord = async () => {
    if (!result) return;

    const lines = result.corrected_optimized_resume.plain_text.split('\n');

    const paragraphs = lines.map((line) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        return new Paragraph({
          children: [new TextRun({ text: ' ' })]
        });
      }

      if (isSectionHeader(line)) {
        return new Paragraph({
          children: [
            new TextRun({
              text: trimmed.toUpperCase(),
              bold: true,
              size: 22
            })
          ],
          spacing: {
            before: 200,
            after: 100
          }
        });
      }

      return new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: false,
            size: 22
          })
        ],
        spacing: {
          before: 60,
          after: 60
        }
      });
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, 'ATS_Audited_Resume.docx');
  };

  const handleReset = () => {
    setStatus('idle');
    setResult(null);
    setResumeText('');
    setError(null);
    // مافي أي لمس للـ usageCount هنا عشان يظل حقيقي
  };

  const radarData = useMemo(() => {
    if (!result) return [];
    return [
      {
        subject: 'Structure',
        A: result.corrected_before_optimization.scores.ats_structure,
        B: result.corrected_after_optimization.scores.ats_structure,
        fullMark: 100
      },
      {
        subject: 'Keywords',
        A: result.corrected_before_optimization.scores.keyword_match,
        B: result.corrected_after_optimization.scores.keyword_match,
        fullMark: 100
      },
      {
        subject: 'Impact',
        A: result.corrected_before_optimization.scores.experience_impact,
        B: result.corrected_after_optimization.scores.experience_impact,
        fullMark: 100
      },
      {
        subject: 'Format',
        A: result.corrected_before_optimization.scores.formatting_readability,
        B: result.corrected_after_optimization.scores.formatting_readability,
        fullMark: 100
      },
      {
        subject: 'Alignment',
        A: result.corrected_before_optimization.scores.seniority_alignment,
        B: result.corrected_after_optimization.scores.seniority_alignment,
        fullMark: 100
      }
    ];
  }, [result]);

  // ================== UI ==================

  return (
    <div className="min-h-screen pb-12 bg-[#f4f7f9]">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-slate-900 p-2 rounded-lg">
              <ShieldCheck className="text-blue-400 w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              ATS <span className="text-blue-600">AUDITOR</span>
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <span className="text-blue-600">Strict Validation</span>
            <span>•</span>
            <span>Enterprise Quality</span>
            <span>•</span>
            <span>Logic v4.2</span>
          </div>
          {status === 'completed' && (
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reset Audit
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {status === 'idle' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div className="space-y-8 lg:sticky lg:top-24">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-bold uppercase tracking-widest">
                  <ShieldAlert className="w-4 h-4 text-blue-400" />
                  <span>Quality Control Mode Active</span>
                </div>
                <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 leading-tight">
                  No More <br />
                  <span className="text-blue-600">AI Optimism.</span>
                </h2>
                <p className="text-lg text-slate-600 leading-relaxed max-w-xl">
                  Our Auditor applies strict penalties for
                  parsing errors and generic content that recruiters reject.
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Uses: <span className="font-bold">{usageCount}</span> / {MAX_USAGE}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: FileSearch, title: 'Penalty Audit', desc: 'Markdown & symbol check' },
                  { icon: Target, title: 'Impact Logic', desc: 'Quantified results only' },
                  { icon: Zap, title: 'Word Density', desc: 'Precise word counts' },
                  { icon: FileSearch, title: 'Trust Scoring', desc: 'Conservative confidence' }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm"
                  >
                    <item.icon className="w-6 h-6 text-blue-600 mb-2" />
                    <h3 className="font-bold text-slate-900 text-sm">{item.title}</h3>
                    <p className="text-xs text-slate-500">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`relative group border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 ${
                  extracting
                    ? 'bg-slate-50 border-blue-300'
                    : 'bg-white border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.docx,.txt"
                  onChange={handleFileUpload}
                />
                {extracting ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                    <p className="font-bold text-slate-900">Parsing Resume...</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <FileText className="w-10 h-10 text-slate-300 mx-auto mb-4" />
                    <p className="font-bold text-slate-900 text-lg">Upload Original Resume</p>
                    <p className="text-sm text-slate-500 mb-4">PDF, Word, or Text (Max 2MB)</p>
                    <span className="px-6 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg group-hover:bg-blue-600 transition-colors">
                      Select File
                    </span>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6">
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">
                  Review Content
                </label>
                <textarea
                  className="w-full h-64 p-4 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm bg-slate-50 text-slate-600"
                  placeholder="Paste resume content here for audit..."
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                />
                {error && (
                  <div className="mt-4 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-lg flex flex-col gap-1">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <AlertCircle className="w-4 h-4" /> {error.message}
                    </div>
                    {error.hint && (
                      <p className="text-xs text-rose-500 ml-6 italic">{error.hint}</p>
                    )}
                    {error.tech && error.tech === 'USAGE_LIMIT_REACHED' && (
                      <p className="mt-2 text-[11px] text-rose-500">
                        This browser has reached the free quota. Further audits are blocked.
                      </p>
                    )}
                  </div>
                )}
                <button
                  onClick={handleProcess}
                  disabled={!resumeText.trim() || extracting || usageCount >= MAX_USAGE}
                  className="w-full mt-4 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  {usageCount >= MAX_USAGE ? 'Usage Limit Reached' : 'Initiate Quality Audit'}
                  <ChevronRight className="w-5 h-5" />
                </button>
                <p className="mt-2 text-[11px] text-slate-500 text-center">
                  Uses: <span className="font-bold">{usageCount}</span> / {MAX_USAGE}
                </p>
              </div>
            </div>
          </div>
        )}

        {status === 'analyzing' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
              <ShieldCheck className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-blue-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">
                Audit in Progress
              </h3>
              <p className="text-slate-500 font-medium max-w-md">
                Scrubbing text for AI-generated artifacts and ensuring zero-markdown compliance...
              </p>
            </div>
            <button
              onClick={handleCancelAnalysis}
              className="px-6 py-2 border border-slate-200 text-slate-500 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <XCircle className="w-4 h-4" /> Cancel Analysis
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="max-w-2xl mx-auto bg-white border border-rose-100 rounded-3xl p-12 text-center shadow-sm">
            <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldAlert className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-4">Audit Failed</h3>
            <div className="text-slate-600 space-y-4 mb-8">
              <p className="font-bold">{error?.message}</p>
              {error?.hint && (
                <div className="bg-slate-50 p-4 rounded-xl text-xs text-left border border-slate-100">
                  <span className="font-bold text-slate-900 block mb-1 uppercase tracking-widest">
                    System Hint
                  </span>
                  {error.hint}
                </div>
              )}
            </div>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => setStatus('idle')}
                className="px-8 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-black transition-colors"
              >
                Return to Editor
              </button>
            </div>
          </div>
        )}

        {status === 'completed' && result && (
          <div className="space-y-8 animate-in fade-in duration-1000">
            <div className="bg-slate-900 rounded-3xl p-8 text-white shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <ShieldCheck className="w-64 h-64" />
              </div>
              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 text-blue-300 text-xs font-black uppercase tracking-[0.2em] rounded">
                    Audit Verdict
                  </div>
                  <h2 className="text-3xl font-black">Score Correction & Rationale</h2>
                  <p className="text-slate-400 text-lg leading-relaxed max-w-2xl">
                    {result.credibility_verdict.score_change_rationale}
                  </p>
                  <div className="flex flex-wrap gap-4 pt-4">
                    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                      <span className="block text-xs font-bold text-slate-500 uppercase mb-1">
                        Enterprise Readiness
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {result.credibility_verdict.enterprise_readiness}
                      </span>
                    </div>
                    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                      <span className="block text-xs font-bold text-slate-500 uppercase mb-1">
                        Trust Level
                      </span>
                      <span className="text-blue-400 font-bold uppercase tracking-widest">
                        {result.credibility_verdict.trust_level}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-600 rounded-2xl p-6 flex flex-col justify-between">
                  <div>
                    <span className="text-blue-200 text-xs font-black uppercase tracking-widest">
                      Audited Score
                    </span>
                    <div className="text-6xl font-black text-white mt-1">
                      {result.corrected_after_optimization.final_ats_score}
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/20">
                    <span className="text-blue-200 text-xs font-bold">Confidence Level</span>
                    <div className="w-full bg-blue-900 h-2 mt-2 rounded-full overflow-hidden">
                      <div
                        className="bg-white h-full transition-all duration-1000"
                        style={{
                          width: `${result.corrected_after_optimization.ats_confidence_level}%`
                        }}
                      ></div>
                    </div>
                    <div className="text-right text-xs font-bold text-white mt-1">
                      {result.corrected_after_optimization.ats_confidence_level}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Search className="w-4 h-4 text-blue-600" /> Auditor Findings
                  </h3>
                  <div className="space-y-6">
                    {result.audit_findings.map((find, idx) => (
                      <div key={idx} className="space-y-2 border-l-2 border-amber-500 pl-4">
                        <h4 className="font-black text-slate-900 text-sm">{find.issue}</h4>
                        <p className="text-xs text-slate-500 italic">
                          "{find.why_it_is_a_problem}"
                        </p>
                        <div className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded inline-block uppercase">
                          Action: {find.correction_applied}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-6">
                    Comparative Logic
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis
                          dataKey="subject"
                          tick={{
                            fontSize: 10,
                            fill: '#64748b',
                            fontWeight: 'bold'
                          }}
                        />
                        <Radar
                          name="Original"
                          dataKey="A"
                          stroke="#94a3b8"
                          fill="#94a3b8"
                          fillOpacity={0.2}
                        />
                        <Radar
                          name="Audited"
                          dataKey="B"
                          stroke="#2563eb"
                          fill="#2563eb"
                          fillOpacity={0.4}
                        />
                        <Legend iconType="circle" />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-blue-600" />
                      <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">
                        ATS-Safe Resume
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopy}
                        className="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      <button
                        onClick={handleDownloadPDF}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-black transition-all"
                      >
                        <FileDown className="w-4 h-4" /> PDF
                      </button>
                      <button
                        onClick={handleDownloadWord}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all"
                      >
                        <Download className="w-4 h-4" /> DOCX
                      </button>
                    </div>
                  </div>

                  <div className="p-8 sm:p-12 bg-white">
                    <div className="font-sans text-slate-700 text-sm leading-relaxed selection:bg-blue-100 outline-none">
                      {renderResumeText(result.corrected_optimized_resume.plain_text)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">
                      Original Scoring
                    </h4>
                    <div className="space-y-4">
                      {Object.entries(result.corrected_before_optimization.scores).map(
                        ([key, val]) => (
                          <div key={key}>
                            <div className="flex justify-between text-[11px] font-bold text-slate-500 mb-1">
                              <span className="uppercase tracking-widest">
                                {key.replace('_', ' ')}
                              </span>
                              <span>{val}%</span>
                            </div>
                            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-slate-300 rounded-full"
                                style={{ width: `${val}%` }}
                              ></div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                  <div className="bg-white border border-blue-100 rounded-2xl p-6">
                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4">
                      Audited Scoring
                    </h4>
                    <div className="space-y-4">
                      {Object.entries(result.corrected_after_optimization.scores).map(
                        ([key, val]) => (
                          <div key={key}>
                            <div className="flex justify-between text-[11px] font-bold text-slate-900 mb-1">
                              <span className="uppercase tracking-widest">
                                {key.replace('_', ' ')}
                              </span>
                              <span>{val}%</span>
                            </div>
                            <div className="h-1 bg-blue-50 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-600 rounded-full"
                                style={{ width: `${val}%` }}
                              ></div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 mt-20 border-t pt-8 pb-12 flex flex-col md:flex-row justify-between items-center text-slate-400 text-[10px] font-bold uppercase tracking-widest gap-4">
        <p>© 2025 ATS PRO Enterprise Systems • Internal Quality Control Tool</p>
        <div className="flex gap-6">
          <span>Logic v4.2.11</span>
          <span>Compliance: ISO/ATS-2025</span>
        </div>
      </footer>
    </div>
  );
}
