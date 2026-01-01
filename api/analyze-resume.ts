// api/analyze-resume.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import type { AnalysisResult } from '../src/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured in Vercel' });
    }

    const { resumeText } = req.body as { resumeText?: string };

    if (!resumeText || typeof resumeText !== 'string') {
      return res.status(400).json({ error: 'resumeText is required as string' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const cleanedInput = resumeText.slice(0, 15000);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
You are a Senior Executive Recruiter and ATS Auditor.
Your job is to audit and rewrite the following resume into a high-performance, ATS-safe document.

The resume can belong to ANY profession, level, or country. 
Do NOT assume details that are not supported by the text. You may generalize responsibilities,
but stay realistic to the role and context.

TARGET LENGTH: 500–700 words.

Return ONLY JSON that matches the responseSchema. 
No explanations, no markdown, no extra text.

RESUME TO AUDIT:
"""
${cleanedInput}
"""
      `,
      config: {
        systemInstruction: `
You are an elite Enterprise ATS Quality Control Auditor & Global Recruiter.

MISSION:
- Rewrite the resume so it is clear, impact-driven, and ATS-friendly.
- If the input is short or poorly written, expand using realistic responsibilities
  for that role level (junior / mid / senior) without inventing fake achievements.
- Every bullet should follow Action–Context–Result (ACR) and use metrics when possible (%, $, time, volume, scale).

CRITICAL RULES FOR corrected_optimized_resume.plain_text:

1) PLAIN TEXT ONLY:
   - No markdown (** , # , __ , • , numbered lists).
   - Use only basic characters.

2) NO PIPES:
   - Do NOT use the "|" character at all.

3) SECTION HEADERS:
   - Use clear UPPERCASE headings:
     PROFESSIONAL SUMMARY
     EXPERIENCE
     PROJECTS
     SKILLS
     EDUCATION
     CERTIFICATIONS
     LANGUAGES
   - Each heading on its own line.

4) VERTICAL LAYOUT:
   - Multi-line resume.
   - One blank line between sections.
   - One bullet per line.

5) BULLETS:
   - Each bullet starts with "- " (hyphen + space).

6) CONTACT INFO:
   - Fields on separate lines.
   - No "Name | Email | Phone".

SCORING PHILOSOPHY:
- Penalize generic phrases if overused.
- Reward clear impact with numbers where possible.
- Keep ats_rejection_risk realistic (High/Medium-High) إذا المعلومات ضعيفة.

CONSISTENCY:
- corrected_optimized_resume.plain_text = final resume.
- corrected_optimized_resume.sections must match the same content.
        `,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            audit_findings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  issue: { type: Type.STRING },
                  why_it_is_a_problem: { type: Type.STRING },
                  ats_real_world_impact: { type: Type.STRING },
                  correction_applied: { type: Type.STRING },
                },
                required: [
                  'issue',
                  'why_it_is_a_problem',
                  'ats_real_world_impact',
                  'correction_applied',
                ],
              },
            },
            corrected_before_optimization: {
              type: Type.OBJECT,
              properties: {
                scores: {
                  type: Type.OBJECT,
                  properties: {
                    ats_structure: { type: Type.NUMBER },
                    keyword_match: { type: Type.NUMBER },
                    experience_impact: { type: Type.NUMBER },
                    formatting_readability: { type: Type.NUMBER },
                    seniority_alignment: { type: Type.NUMBER },
                  },
                  required: [
                    'ats_structure',
                    'keyword_match',
                    'experience_impact',
                    'formatting_readability',
                    'seniority_alignment',
                  ],
                },
                final_ats_score: { type: Type.NUMBER },
                ats_confidence_level: { type: Type.NUMBER },
                ats_rejection_risk: { type: Type.STRING },
              },
              required: [
                'scores',
                'final_ats_score',
                'ats_confidence_level',
                'ats_rejection_risk',
              ],
            },
            corrected_optimized_resume: {
              type: Type.OBJECT,
              properties: {
                plain_text: { type: Type.STRING },
                sections: {
                  type: Type.OBJECT,
                  properties: {
                    summary: { type: Type.STRING },
                    experience: { type: Type.STRING },
                    skills: { type: Type.STRING },
                    education: { type: Type.STRING },
                  },
                  required: ['summary', 'experience', 'skills', 'education'],
                },
              },
              required: ['plain_text', 'sections'],
            },
            corrected_after_optimization: {
              type: Type.OBJECT,
              properties: {
                scores: {
                  type: Type.OBJECT,
                  properties: {
                    ats_structure: { type: Type.NUMBER },
                    keyword_match: { type: Type.NUMBER },
                    experience_impact: { type: Type.NUMBER },
                    formatting_readability: { type: Type.NUMBER },
                    seniority_alignment: { type: Type.NUMBER },
                  },
                  required: [
                    'ats_structure',
                    'keyword_match',
                    'experience_impact',
                    'formatting_readability',
                    'seniority_alignment',
                  ],
                },
                final_ats_score: { type: Type.NUMBER },
                ats_confidence_level: { type: Type.NUMBER },
                ats_rejection_risk: { type: Type.STRING },
              },
              required: [
                'scores',
                'final_ats_score',
                'ats_confidence_level',
                'ats_rejection_risk',
              ],
            },
            credibility_verdict: {
              type: Type.OBJECT,
              properties: {
                score_change_rationale: { type: Type.STRING },
                trust_level: { type: Type.STRING },
                enterprise_readiness: { type: Type.STRING },
              },
              required: [
                'score_change_rationale',
                'trust_level',
                'enterprise_readiness',
              ],
            },
          },
          required: [
            'audit_findings',
            'corrected_before_optimization',
            'corrected_optimized_resume',
            'corrected_after_optimization',
            'credibility_verdict',
          ],
        },
      },
    });

    const anyResponse = response as any;
    const rawText =
      typeof anyResponse.text === 'function'
        ? await anyResponse.text()
        : anyResponse.text;

    if (!rawText || typeof rawText !== 'string') {
      throw new Error('EMPTY_AI_RESPONSE');
    }

    const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    res.status(200).json(parsed as AnalysisResult);
  } catch (error: any) {
    console.error('Gemini backend error:', error?.response ?? error);
    res.status(500).json({
      error: 'GEMINI_BACKEND_ERROR',
      message: error?.message || 'Unknown error from Gemini API',
    });
  }
}
