
export interface Scores {
  ats_structure: number;
  keyword_match: number;
  experience_impact: number;
  formatting_readability: number;
  seniority_alignment: number;
}

export interface OptimizationAuditData {
  scores: Scores;
  final_ats_score: number;
  ats_confidence_level: number;
  ats_rejection_risk: string;
}

export interface AuditFinding {
  issue: string;
  why_it_is_a_problem: string;
  ats_real_world_impact: string;
  correction_applied: string;
}

export interface AnalysisResult {
  audit_findings: AuditFinding[];
  corrected_before_optimization: OptimizationAuditData;
  corrected_optimized_resume: {
    plain_text: string;
    sections: {
      summary: string;
      experience: string;
      skills: string;
      education: string;
    };
  };
  corrected_after_optimization: OptimizationAuditData;
  credibility_verdict: {
    score_change_rationale: string;
    trust_level: string;
    enterprise_readiness: string;
  };
}

export type AppStatus = 'idle' | 'analyzing' | 'completed' | 'error';
