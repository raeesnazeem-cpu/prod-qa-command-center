import { supabase } from '../lib/supabase';
import { generateEmbedding } from '@qacc/ai';
import { logger } from '../lib/logger';

export interface RAGResult {
  source_type: string;
  source_id: string;
  content: string;
  similarity: number;
  metadata: any;
}

export async function semanticSearch(
  query: string,
  orgId: string,
  projectId?: string,
  sourceType?: 'finding' | 'task',
  limit: number = 8
): Promise<RAGResult[]> {
  const embedding = await generateEmbedding(query);

  let rpcParams: any = {
    query_embedding: embedding,
    query_org_id: orgId,
    match_count: limit,
  };

  // Optional filters
  if (projectId) rpcParams.query_project_id = projectId;
  if (sourceType) rpcParams.query_source_type = sourceType;

  const { data, error } = await supabase.rpc('match_embeddings', rpcParams);

  if (error) {
    logger.error({ error: error.message }, 'RAG search failed');
    throw error;
  }

  return (data || []) as RAGResult[];
}

export function formatRAGResults(results: RAGResult[]): string {
  if (!results.length) return 'No matching issues found.';

  const grouped = { finding: [] as RAGResult[], task: [] as RAGResult[] };
  results.forEach(r => {
    if (r.source_type === 'finding') grouped.finding.push(r);
    else grouped.task.push(r);
  });

  const lines: string[] = [];

  if (grouped.finding.length) {
    lines.push(`🔍 **${grouped.finding.length} matching findings:**`);
    grouped.finding.forEach((r, i) => {
      const meta = r.metadata || {};
      lines.push(`${i + 1}. **${meta.title || 'Finding'}** — ${meta.severity || ''} · ${meta.status || ''}`);
      if (meta.page_url) lines.push(`   📄 ${meta.page_url}`);
      lines.push(`   ${r.content.slice(0, 120)}...`);
    });
  }

  if (grouped.task.length) {
    lines.push(`\n **${grouped.task.length} matching tasks:**`);
    grouped.task.forEach((r, i) => {
      const meta = r.metadata || {};
      lines.push(`${i + 1}. **${meta.title || 'Task'}** — ${meta.severity || ''} · ${meta.status || ''}`);
      lines.push(`   ${r.content.slice(0, 120)}...`);
    });
  }

  return lines.join('\n');
}