// src/geminiService.ts
import type { AnalysisResult } from "./types";

export const analyzeResume = async (
  resumeText: string,
  signal?: AbortSignal
): Promise<AnalysisResult> => {
  const res = await fetch("/api/analyze-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Backend error:", res.status, text);
    throw new Error(`BACKEND_ERROR_${res.status}`);
  }

  const data = await res.json();
  return data as AnalysisResult;
};
