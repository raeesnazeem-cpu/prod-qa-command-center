import axios from 'axios';

const pkg = require('../../package.json');

interface CreateBasecampTodoParams {
  token: string;
  accountId: string;
  projectId: string;
  todolistId: string;
  title: string;
  description: string;
  assigneeIds?: number[];
}

/**
 * Creates a to-do in Basecamp 3
 */
export async function createBasecampTodo(params: CreateBasecampTodoParams): Promise<{ id: number; url: string }> {
  const { token, accountId, projectId, todolistId, title, description, assigneeIds } = params;

  // Basecamp 3 recommends flat routes where possible. 
  // We use the todolists endpoint directly to reduce potential 404s from bucket hierarchy mismatches.
  const url = `https://3.basecampapi.com/${accountId}/todolists/${todolistId}/todos.json`;
  
  console.log(`[BasecampClient] Creating todo at URL: ${url}`);

  const requestBody = {
    content: title,
    description: description,
    assignee_ids: assigneeIds || [],
  };

  console.log('[BasecampClient] POST Request Body:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await axios.post(
      url,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': `${pkg.name} (${process.env.SUPPORT_EMAIL || 'raees.nazeem@growth99.com'}) v${pkg.version}`,
        },
      }
    );

    return {
      id: response.data.id,
      url: response.data.app_url,
    };
  } catch (error: any) {
    if (error.response) {
      const detailedError = new Error(`Basecamp API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      (detailedError as any).status = error.response.status;
      (detailedError as any).data = error.response.data;
      throw detailedError;
    }
    throw error;
  }
}

/**
 * Fetches all people in the Basecamp account to get their SGIDs for mentions.
 */
export async function getBasecampPeople(token: string, accountId: string): Promise<Record<number, any>> {
  const url = `https://3.basecampapi.com/${accountId}/people.json`;
  
  console.log(`[BasecampClient] Fetching people from URL: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `${pkg.name} (${process.env.SUPPORT_EMAIL || 'raees.nazeem@growth99.com'}) v${pkg.version}`,
      },
    });

    console.log('[BasecampClient] RAW People API Response:', JSON.stringify(response.data, null, 2));

    const peopleMap: Record<number, any> = {};
    
    if (Array.isArray(response.data)) {
      response.data.forEach((person: any) => {
        peopleMap[person.id] = person;
      });
    }

    return peopleMap;
  } catch (error: any) {
    if (error.response) {
      const detailedError = new Error(`Basecamp API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      (detailedError as any).status = error.response.status;
      (detailedError as any).data = error.response.data;
      throw detailedError;
    }
    throw error;
  }
}

/**
 * Fetches a single person in the Basecamp account.
 */
export async function getBasecampPerson(token: string, accountId: string, personId: number): Promise<any> {
  const url = `https://3.basecampapi.com/${accountId}/people/${personId}.json`;
  
  console.log(`[BasecampClient] Fetching person ${personId} from URL: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `${pkg.name} (${process.env.SUPPORT_EMAIL || 'raees.nazeem@growth99.com'}) v${pkg.version}`,
      },
    });

    console.log(`[BasecampClient] Person ${personId} response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: any) {
    console.error(`[BasecampClient] Error fetching person ${personId}:`, error.message);
    return null;
  }
}

/**
 * Formats a Basecamp mention HTML tag.
 */
export function formatBasecampMention(sgid: string, name: string): string {
  return `<bc-attachment sgid="${sgid}" content-type="application/vnd.basecamp.mention"><figure><figcaption>${name}</figcaption></figure></bc-attachment>`;
}

/**
 * Adds a comment to a recording (to-do, etc.) in Basecamp 3
 */
export async function createBasecampComment(params: {
  token: string;
  accountId: string;
  projectId: string;
  recordingId: string;
  content: string;
}): Promise<{ id: number; url: string }> {
  const { token, accountId, projectId, recordingId, content } = params;
  const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings/${recordingId}/comments.json`;
  
  console.log(`[BasecampClient] Creating comment at URL: ${url}`);

  try {
    const response = await axios.post(
      url,
      { content },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': `${pkg.name} (${process.env.SUPPORT_EMAIL || 'raees.nazeem@growth99.com'}) v${pkg.version}`,
        },
      }
    );

    return {
      id: response.data.id,
      url: response.data.app_url
    };
  } catch (error: any) {
    if (error.response) {
      const detailedError = new Error(`Basecamp API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      (detailedError as any).status = error.response.status;
      (detailedError as any).data = error.response.data;
      throw detailedError;
    }
    throw error;
  }
}

/**
 * Deletes a comment from a recording in Basecamp 3
 * Used for rollback when notification fails
 */
export async function deleteBasecampComment(params: {
  token: string;
  accountId: string;
  projectId: string;
  recordingId: string;
  commentId: number;
}): Promise<void> {
  const { token, accountId, projectId, recordingId, commentId } = params;
  const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings/${commentId}/status/trashed.json`;

  try {
    await axios.put(url, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `${pkg.name} (${process.env.SUPPORT_EMAIL || 'raees.nazeem@growth99.com'}) v${pkg.version}`,
      },
    });
  } catch (error: any) {
    if (error.response) {
      const detailedError = new Error(`Basecamp API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      (detailedError as any).status = error.response.status;
      (detailedError as any).data = error.response.data;
      throw detailedError;
    }
    throw error;
  }
}
