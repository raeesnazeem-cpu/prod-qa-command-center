import { supabase } from '../lib/supabase';
import { generateEmbedding } from '@qacc/ai';
import { logger } from '../lib/logger';

export async function upsertFindingEmbedding(
  finding: {
    id: string;
    run_id: string;
    title: string;
    description: string;
    severity: string;
    status: string;
    org_id: string;
    project_id: string;
    page_url?: string;
  }
) {
  const content = `${finding.title}. ${finding.description}`;
  const embedding = await generateEmbedding(content);

  const { error } = await supabase
    .from('embeddings')
    .upsert({
      org_id: finding.org_id,
      project_id: finding.project_id,
      source_type: 'finding',
      source_id: finding.id,
      content,
      embedding,
      metadata: {
        title: finding.title,
        severity: finding.severity,
        status: finding.status,
        page_url: finding.page_url,
        run_id: finding.run_id,
      }
    }, { onConflict: 'source_type,source_id' });

  if (error) logger.error({ error: error.message }, 'Failed to upsert finding embedding');
}

export async function upsertTaskEmbedding(
  task: {
    id: string;
    project_id: string;
    org_id: string;
    title: string;
    description?: string;
    severity: string;
    status: string;
  }
) {
  const content = `${task.title}. ${task.description || ''}`.trim();
  const embedding = await generateEmbedding(content);

  const { error } = await supabase
    .from('embeddings')
    .upsert({
      org_id: task.org_id,
      project_id: task.project_id,
      source_type: 'task',
      source_id: task.id,
      content,
      embedding,
      metadata: {
        title: task.title,
        severity: task.severity,
        status: task.status,
      }
    }, { onConflict: 'source_type,source_id' });

  if (error) logger.error({ error: error.message }, 'Failed to upsert task embedding');
}