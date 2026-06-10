-- Add updated_at to embeddings table
ALTER TABLE embeddings ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Auto-update updated_at via trigger
CREATE TRIGGER trg_embeddings_updated_at
  BEFORE UPDATE ON embeddings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
