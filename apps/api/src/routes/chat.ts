import { Router, Request, Response } from 'express';
import { clerkAuth } from '../middleware/clerkAuth';
import { aiRateLimiter } from '../middleware/rateLimiter';
import { supabase } from '../lib/supabase';
import { TOOL_DEFINITIONS } from '@qacc/ai';
import * as queries from '../tools/queries';
import * as mutations from '../tools/mutations';
import * as ragSearch from '../tools/ragSearch';
import { chatWithFallback, transcribeAudio } from '../lib/aiProviders';

import { logger } from '../lib/logger';

const router = Router();

/**
 * POST /api/chat
 * RAG-based chatbot using Gemini 1.5 Flash and Supabase vector search.
 */
router.post('/', clerkAuth, aiRateLimiter, async (req: Request, res: Response) => {
  const { message, history, project_id, run_id } = req.body;
  const { orgId, userId: supabaseUserId } = req.auth!;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Fetch performer details for activity logging
    const { data: userProfile } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', supabaseUserId)
      .single();
    
    const performer = {
      id: supabaseUserId,
      name: userProfile?.full_name || 'System User'
    };

    const executeToolCall = async (name: string, args: any) => {
      logger.info({ name, args }, 'Executing tool call');
      
      // Normalize common parameters that AI models often swap between snake_case and camelCase
      const projectId = args.project_id || args.projectId;
      const userId = args.user_id || args.userId;
      const taskId = args.task_id || args.taskId;
      const runId = args.run_id || args.runId;
      const findingId = args.finding_id || args.findingId;

      const result = await (async () => {
        switch (name) {
          case 'find_project': return await queries.findProjectByName(args.project_name || args.projectName, orgId);
          case 'find_projects_bulk': return await queries.findProjectsByNames(args.project_names || args.projectNames, orgId);
          case 'get_project_stats': return await queries.getProjectStats(projectId);
          case 'get_task_stats': return await queries.getTaskStats(projectId);
          case 'get_developers': return await queries.getDevelopersForProject(projectId);
          case 'get_qa_engineers': return await queries.getQAForProject(projectId);
          case 'get_project_members': return await queries.getProjectMembers(projectId);
          case 'get_project_status': return await queries.getProjectPreReleaseStatus(projectId);
          case 'get_basecamp_link': return await queries.getProjectBasecampLink(projectId);
          case 'get_issues_by_developer': return await queries.getIssueCountsByDeveloper(projectId);
          case 'get_issues_by_qa': return await queries.getIssueCountsByQA(projectId);
          case 'get_all_users': return await queries.getAllOrgUsers(orgId);
          case 'find_user': return await queries.getUserByEmail(args.email, orgId);
          case 'find_user_by_name': return await queries.findUserByName(args.name, orgId);
          case 'get_user_tasks': return await queries.getTasksByUserId(userId);
          case 'get_user_task_stats': return await queries.getUserTaskStats(userId);
          case 'get_org_task_stats': return await queries.getOrgTaskStats(orgId);
          case 'list_projects': return await queries.listProjects(orgId);
          case 'get_user_projects': return await queries.getUserProjects(userId);
          
          case 'create_project': return await mutations.createProject(args, orgId, performer);
          case 'update_project': return await mutations.updateProject({ ...args, project_id: projectId }, orgId, performer);
          case 'delete_project': return await mutations.deleteProject({ ...args, project_id: projectId }, orgId, performer);
          case 'delete_projects_bulk': return await mutations.deleteProjectsBulk({ ...args, project_ids: args.project_ids || args.projectIds }, orgId, performer);
          case 'add_project_member': return await mutations.addProjectMember({ ...args, project_id: projectId, user_id: userId }, performer);
          case 'remove_project_member': return await mutations.removeProjectMember({ ...args, project_id: projectId, user_id: userId }, performer);
          case 'create_task': return await mutations.createTask({ ...args, project_id: projectId, assigned_to: userId || args.assignedTo }, orgId, performer);
          case 'update_task': return await mutations.updateTask({ ...args, task_id: taskId, project_id: projectId, assigned_to: userId || args.assignedTo }, orgId, performer);
          case 'delete_task': return await mutations.deleteTask({ ...args, task_id: taskId, project_id: projectId }, performer);
          case 'delete_tasks_bulk': return await mutations.deleteTasksBulk({ ...args, task_ids: args.task_ids, project_id: projectId }, performer);
          case 'delete_user_tasks_in_project': return await mutations.deleteUserTasksInProject({ ...args, user_id: userId, project_id: projectId }, performer);
          case 'update_finding': return await mutations.updateFinding({ ...args, finding_id: findingId, run_id: runId }, orgId, performer);
          case 'delete_finding': return await mutations.deleteFinding({ ...args, finding_id: findingId, run_id: runId }, performer);
          case 'update_user_role': return await mutations.updateUserRole({ ...args, user_id: userId }, performer);
          case 'create_qa_run': return await mutations.createRun({ ...args, project_id: projectId }, performer);
          case 'cancel_qa_run': return await mutations.cancelRun({ ...args, run_id: runId, project_id: projectId }, performer);
          
          case 'search_issues': return await ragSearch.semanticSearch(args.query, orgId, projectId, args.source_type || args.sourceType);
          
          default: throw new Error(`Unknown tool: ${name}`);
        }
      })();

      logger.info({ name, result }, 'Tool call result');
      return result;
    };

    const systemPrompt = `You are a concise QA assistant.
IMPORTANT MAPPINGS:
- "issues" = tasks
- "tasks for [user]" = tasks assigned to that user (use find_user_by_name then get_user_tasks)
- "projects for [user]" = projects assigned to that user (use find_user_by_name then get_user_projects)
- "how many [status] tasks for [user]" = status counts for a user (use find_user_by_name then get_user_task_stats)
- "how many [status] tasks" = status counts for the organization (use get_org_task_stats)
- "working on issues" = tasks assigned to developers (use get_issues_by_developer for project-wide or get_user_tasks for specific user)
- "who is working on" = show developers with their task counts
- "resolved/to-do/in-progress/closed" = task statuses

SAFETY PROTOCOL:
- You MUST NOT call tools that modify or delete data (update_*, delete_*) without explicit confirmation from the user in the current conversation.
- Always state the specific name of the item you intend to modify/delete when asking for confirmation.
- Once the user confirms, proceed with the tool call.

PROJECT CREATION FLOW:
- MANDATORY: site_url.
- You MUST confirm: 1. Is it a pre-release project? 2. Is it an internal project?
- If NOT internal, you MUST ask for the client name.
- Do not call create_project until these are confirmed.

ENTITY DISCOVERY:
- If project names are mentioned, ALWAYS call find_project or find_projects_bulk FIRST to get the project_id(s).
- If a person's name is mentioned, ALWAYS call find_user_by_name FIRST to get the user_id.
- If it's ambiguous whether a name refers to a project or a user, try find_project first. If it returns no results, try find_user_by_name.

RULES:
- After finding an entity (project or user), extract the id field and use it in subsequent tool calls.
- Once you have the data you need, STOP calling tools and write your final answer.
- ALWAYS use the designated tool calling mechanism. Do NOT attempt to call tools using manual text tags like <function>.
- Use line breaks and bullet points for better readability.
- Keep responses short and focused.`;

    const fullHistory = history || [];
    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...fullHistory,
      { role: 'user', content: message }
    ];

    // Stream the final response using SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const result = await chatWithFallback(formattedMessages as any, TOOL_DEFINITIONS, executeToolCall, (provider, stats) => {
      // Stream intermediate status updates
      res.write(`data: [METADATA]${JSON.stringify({ intermediate: true, provider, stats })}\n\n`);
    });
    
    const { content, provider, failedProviders, allStats } = result;

    // Final metadata sync (optional but good for consistency)
    res.write(`data: [METADATA]${JSON.stringify({ provider, failedProviders, allStats })}\n\n`);

    // Simulate streaming for better UX, handling newlines correctly
    const textContent = content || '';
    const lines = textContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(' ');
      for (let j = 0; j < words.length; j++) {
        const word = words[j];
        if (!word && j > 0 && j < words.length - 1) continue; // Skip extra spaces but keep intentional ones
        const suffix = j < words.length - 1 ? ' ' : '';
        res.write(`data: ${word}${suffix}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (i < lines.length - 1) {
        res.write(`data: \n\n`); // This results in an empty data line on the frontend, interpreted as \n
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    console.error('FULL CHAT ERROR:', error);
    logger.error({ error: error.message }, 'Error in chat route');
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to process chat message', details: error.message });
    }
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/chat/transcribe
 * Transcribe audio from base64 string using Groq Whisper.
 */
router.post('/transcribe', clerkAuth, aiRateLimiter, async (req: Request, res: Response) => {
  const { audio } = req.body;

  if (!audio) {
    return res.status(400).json({ error: 'Audio data is required' });
  }

  try {
    const base64Data = audio.includes('base64,') ? audio.split('base64,')[1] : audio;
    const buffer = Buffer.from(base64Data, 'base64');
    
    const text = await transcribeAudio(buffer);
    res.json({ text });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Transcription route failed');
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});


export const chatRouter: Router = router;
