-- ============================================================
-- 005_rag.sql
-- Vector embeddings for RAG (Retrieval-Augmented Generation)
-- ============================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table for semantic search across org content
CREATE TABLE embeddings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type  text NOT NULL
                 CHECK (source_type IN ('finding','comment','rebuttal','sign_off','task')),
  source_id    uuid NOT NULL,
  content      text NOT NULL,
  embedding    vector(768) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_embeddings_org_id      ON embeddings(org_id);
CREATE INDEX idx_embeddings_source_type ON embeddings(source_type);
CREATE INDEX idx_embeddings_source_id   ON embeddings(source_id);

-- IVFFlat index for approximate cosine similarity search
-- (Requires at least ~1000 rows before it becomes beneficial)
CREATE INDEX idx_embeddings_ivfflat
  ON embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- Function: match_embeddings
-- Returns top-N most similar embeddings for a given org,
-- ordered by cosine similarity (highest first).
-- ============================================================
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(768),
  match_count     int,
  p_org_id        uuid
)
RETURNS TABLE (
  id           uuid,
  org_id       uuid,
  source_type  text,
  source_id    uuid,
  content      text,
  similarity   float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.org_id,
    e.source_type,
    e.source_id,
    e.content,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.org_id = p_org_id
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
