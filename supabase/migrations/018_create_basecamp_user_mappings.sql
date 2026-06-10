-- Create basecamp_user_mappings table
CREATE TABLE IF NOT EXISTS basecamp_user_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  basecamp_person_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_basecamp_user_mappings_user_id ON basecamp_user_mappings(user_id);

-- Enable RLS
ALTER TABLE basecamp_user_mappings ENABLE ROW LEVEL SECURITY;

-- Simple policy: Users can read all mappings (to see assignees), but only admins or the user themselves can update their mapping.
CREATE POLICY "Mappings are readable by all authenticated users"
  ON basecamp_user_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage their own mapping"
  ON basecamp_user_mappings FOR ALL
  TO authenticated
  USING (auth.uid()::text = (SELECT clerk_user_id FROM users WHERE id = user_id))
  WITH CHECK (auth.uid()::text = (SELECT clerk_user_id FROM users WHERE id = user_id));
