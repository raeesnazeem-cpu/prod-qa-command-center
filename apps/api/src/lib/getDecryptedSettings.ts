import { supabase } from './supabase';
import { decrypt } from './encryption';

export interface DecryptedSettings {
  project_id: string;
  figma_token: string | null;
  basecamp_token: string | null;
  basecamp_account_id: string | null;
  basecamp_project_id: string | null;
  basecamp_todolist_id: string | null;
  basecamp_post_todolist_id: string | null;
  slack_webhook_url: string | null;
  google_chat_webhook_url: string | null;
  google_chat_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches and decrypts all tokens for a project's settings.
 * This is intended for internal server use only.
 * @param projectId The UUID of the project
 * @returns A plain object with decrypted tokens
 */
export async function getProjectSettings(projectId: string): Promise<DecryptedSettings | null> {
  try {
    const { data, error } = await supabase
      .from('project_settings')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No settings found
      }
      throw error;
    }

    if (!data) return null;

    // Decrypt figma_token if it exists
    let decryptedFigmaToken = null;
    if (data.figma_token_encrypted) {
      try {
        decryptedFigmaToken = decrypt(data.figma_token_encrypted);
      } catch (e) {
        console.error(`Failed to decrypt figma_token for project ${projectId}:`, e);
        decryptedFigmaToken = null;
      }
    }

    // Decrypt basecamp_token if it exists
    let decryptedBasecampToken = null;
    if (data.basecamp_token_encrypted) {
      try {
        decryptedBasecampToken = decrypt(data.basecamp_token_encrypted);
      } catch (e) {
        console.error(`Failed to decrypt basecamp_token for project ${projectId}:`, e);
        decryptedBasecampToken = null;
      }
    }

    return {
      ...data,
      figma_token: decryptedFigmaToken,
      basecamp_token: decryptedBasecampToken,
    };
  } catch (error) {
    console.error(`Error fetching decrypted settings for project ${projectId}:`, error);
    throw error;
  }
}
