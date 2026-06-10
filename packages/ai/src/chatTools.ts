export const TOOL_DEFINITIONS = [
  // --- Query Tools ---
  {
    name: 'find_project',
    description: 'Find a project by name using fuzzy matching. Always call this FIRST when a project name is mentioned to get the project_id. ALWAYS use snake_case for parameters.',
    parameters: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'The name of the project to search for (use snake_case)' }
      },
      required: ['project_name']
    }
  },
  {
    name: 'find_projects_bulk',
    description: 'Find multiple projects by name using fuzzy matching. Use this when the user mentions multiple projects in one request.',
    parameters: {
      type: 'object',
      properties: {
        project_names: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of project names to search for'
        }
      },
      required: ['project_names']
    }
  },
  {
    name: 'get_project_stats',
    description: 'Get project findings statistics grouped by status and severity.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_task_stats',
    description: 'Get project task statistics grouped by status.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_developers',
    description: 'List all developers assigned to a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_qa_engineers',
    description: 'List all QA engineers assigned to a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_project_members',
    description: 'List all members of a project with their roles.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_project_status',
    description: 'Get the pre-release or post-release status of a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_basecamp_link',
    description: 'Get the Basecamp project link for a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_issues_by_developer',
    description: 'Get the count of open tasks assigned to each developer in a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_issues_by_qa',
    description: 'Get the count of findings reported by each QA engineer in a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_all_users',
    description: 'List all users in the organization.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'find_user',
    description: 'Find a user by their email address.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address of the user' }
      },
      required: ['email']
    }
  },
  {
    name: 'find_user_by_name',
    description: 'Find a user by their full name using fuzzy matching. Use this when a person name is mentioned. ALWAYS use snake_case for parameters.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the user to search for' }
      },
      required: ['name']
    }
  },
  {
    name: 'get_user_tasks',
    description: 'Get all active (non-closed) tasks assigned to a specific user across all projects. ALWAYS use snake_case for parameters.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' }
      },
      required: ['user_id']
    }
  },
  {
    name: 'get_user_task_stats',
    description: 'Get counts of tasks grouped by status (open, in_progress, resolved, closed) for a specific user. Use this when asked for "number of" or "how many" tasks a user has. ALWAYS use snake_case for parameters.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' }
      },
      required: ['user_id']
    }
  },
  {
    name: 'get_org_task_stats',
    description: 'Get counts of tasks grouped by status (open, in_progress, resolved, closed) for the entire organization across all projects. Use this for global statistics.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_user_projects',
    description: 'Get all projects a specific user is assigned to. Use this when asked "which projects" or "how many projects" a person has. ALWAYS use snake_case for parameters.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' }
      },
      required: ['user_id']
    }
  },


  // --- Mutation Tools ---
  {
    name: 'create_project',
    description: 'Create a new project. Requirements: site_url is MANDATORY. You MUST confirm if it is a pre-release project and if it is an internal project. If NOT internal, you MUST ask for the client name.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project display name' },
        site_url: { type: 'string', description: 'Base URL (Mandatory)' },
        client_name: { type: 'string', description: 'Client name (Required if not internal)' },
        is_pre_release: { type: 'boolean', description: 'Whether this is a pre-release project' },
        is_internal: { type: 'boolean', description: 'Whether this is an internal project' }
      },
      required: ['name', 'site_url', 'is_pre_release', 'is_internal']
    }
  },
  {
    name: 'update_project',
    description: 'Update an existing project details.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        site_url: { type: 'string' },
        client_name: { type: 'string' },
        is_pre_release: { type: 'boolean' },
        status: { type: 'string', enum: ['active', 'archived', 'paused'] }
      },
      required: ['project_id']
    }
  },
  {
    name: 'delete_project',
    description: "Delete a project and all its associated data (runs, tasks, findings). Use this ONLY when specifically asked to 'delete' a project.",
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'delete_projects_bulk',
    description: "Delete multiple projects and all their associated data. Use this when the user asks to 'delete all these projects' or provides a list.",
    parameters: {
      type: 'object',
      properties: {
        project_ids: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of project UUIDs to delete'
        }
      },
      required: ['project_ids']
    }
  },
  {
    name: 'add_project_member',
    description: 'Add a user to a project with a specific role.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        user_id: { type: 'string' },
        role: { type: 'string', enum: ['developer', 'qa_engineer', 'project_manager'] }
      },
      required: ['project_id', 'user_id', 'role']
    }
  },
  {
    name: 'remove_project_member',
    description: 'Remove a user from a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        user_id: { type: 'string' }
      },
      required: ['project_id', 'user_id']
    }
  },
  {
    name: 'create_task',
    description: 'Create a new task for a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        assigned_to: { type: 'string', description: 'User UUID' },
        finding_id: { type: 'string', description: 'Optional finding UUID to link' }
      },
      required: ['project_id', 'title']
    }
  },
  {
    name: 'update_task',
    description: 'Update task details or status.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
        assigned_to: { type: 'string' }
      },
      required: ['task_id', 'project_id']
    }
  },
  {
    name: 'delete_task',
    description: 'Delete a single task.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        project_id: { type: 'string' }
      },
      required: ['task_id', 'project_id']
    }
  },
  {
    name: 'delete_tasks_bulk',
    description: 'Delete multiple tasks at once. Use this when asked to "delete all", "clear", or remove multiple specific tasks.',
    parameters: {
      type: 'object',
      properties: {
        task_ids: { type: 'array', items: { type: 'string' }, description: 'Array of task UUIDs' },
        project_id: { type: 'string' }
      },
      required: ['task_ids', 'project_id']
    }
  },
  {
    name: 'delete_user_tasks_in_project',
    description: "Delete all tasks assigned to a specific user within a specific project. Use this for 'delete all tasks for [user]' or 'clear tasks for [user]' requests.",
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' },
        project_id: { type: 'string', description: 'The UUID of the project' }
      },
      required: ['user_id', 'project_id']
    }
  },
  {
    name: 'update_finding',
    description: 'Update a finding status or severity.',
    parameters: {
      type: 'object',
      properties: {
        finding_id: { type: 'string' },
        run_id: { type: 'string' },
        status: { type: 'string', enum: ['open', 'confirmed', 'false_positive'] },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['finding_id', 'run_id']
    }
  },
  {
    name: 'delete_finding',
    description: 'Delete a finding.',
    parameters: {
      type: 'object',
      properties: {
        finding_id: { type: 'string' },
        run_id: { type: 'string' }
      },
      required: ['finding_id', 'run_id']
    }
  },
  {
    name: 'update_user_role',
    description: 'Update a users role in the organization.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        role: { type: 'string', enum: ['admin', 'project_manager', 'qa_engineer', 'developer'] }
      },
      required: ['user_id', 'role']
    }
  },
  {
    name: 'create_qa_run',
    description: 'Start a new QA run for a project.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        urls: { type: 'array', items: { type: 'string' } },
        device_matrix: { type: 'array', items: { type: 'string' } },
        start_immediately: { type: 'boolean' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'cancel_qa_run',
    description: 'Cancel an active QA run.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        project_id: { type: 'string' }
      },
      required: ['run_id', 'project_id']
    }
  },

  {
    name: 'list_projects',
    description: 'Lists all projects in the current organization with their IDs and names. Use this when you need to compare projects or don\'t have a specific project name.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // --- RAG Tool ---
  {
    name: 'search_issues',
    description: 'Semantic search across finding descriptions and task descriptions. Use this when the user asks about issues by topic, concept, or symptom — e.g. "login issues", "checkout bugs", "performance problems", "accessibility", "mobile responsiveness", "image issues", "form validation". Do NOT use for counting or status queries — use get_task_stats for those.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query in natural language'
        },
        project_id: {
          type: 'string',
          description: 'Optional: limit search to a specific project'
        },
        source_type: {
          type: 'string',
          enum: ['finding', 'task'],
          description: 'Optional: limit to findings or tasks only'
        }
      },
      required: ['query']
    }
  }
];

export const ORG_ID_PARAMS = [
  'find_project',
  'list_projects',
  'get_all_users',
  'find_user_by_name',
  'get_org_task_stats',
  'create_project',
  'delete_project',
  'delete_projects_bulk',
  'find_projects_bulk',
  'search_issues'
];
