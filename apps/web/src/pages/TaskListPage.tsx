import { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  ChevronRight, 
  Clock, 
  CheckCircle2, 
  User,
  Layers,
  Trash2
} from 'lucide-react';
import { useTasks, useDeleteTask } from '../hooks/useTasks';
import { TaskDetailPanel } from '../components/TaskDetailPanel';
import type { Task, TaskStatus, TaskSeverity } from '../api/tasks.api';
import { format } from 'date-fns';
import { useRole } from '../hooks/useRole';

const getSeverityStyles = (severity: TaskSeverity) => {
  switch (severity) {
    case 'critical': return 'bg-red-50 text-red-600 border-red-100';
    case 'high': return 'bg-orange-50 text-orange-600 border-orange-100';
    case 'medium': return 'bg-yellow-50 text-yellow-600 border-yellow-100';
    case 'low': return 'bg-yellow-50 text-yellow-600 border-yellow-100';
    default: return 'bg-slate-50 text-slate-600 border-slate-100';
  }
};

const getStatusStyles = (status: TaskStatus) => {
  switch (status) {
    case 'open': return 'bg-blue-50 text-blue-600 border-blue-100';
    case 'in_progress': return 'bg-indigo-50 text-indigo-600 border-indigo-100';
    case 'resolved': return 'bg-green-50 text-green-600 border-green-100';
    case 'closed': return 'bg-slate-50 text-slate-600 border-slate-100';
    default: return 'bg-slate-50 text-slate-600 border-slate-100';
  }
};

export const TaskListPage = () => {
  const { isDeveloper, isQaEngineer, profile } = useRole();
  const { mutate: deleteTask } = useDeleteTask();
  const [filters, setFilters] = useState({
    status: '' as TaskStatus | '',
    severity: '' as TaskSeverity | '',
    assignedTo: '',
    search: ''
  });

  // Force assignedTo filter for developers
  useEffect(() => {
    if (isDeveloper && profile?.id && filters.assignedTo !== profile.id) {
      setFilters(prev => ({ ...prev, assignedTo: profile.id }));
    }
  }, [isDeveloper, profile?.id]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const { data: tasksData, isLoading } = useTasks({
    status: filters.status || undefined,
    severity: filters.severity || undefined,
    assignedTo: filters.assignedTo || undefined
  });

  const filteredTasks = useMemo(() => {
    if (!tasksData?.data) return [];
    let tasks = tasksData.data;
    if (filters.search) {
      const search = filters.search.toLowerCase();
      tasks = tasks.filter(t => 
        t.title.toLowerCase().includes(search) || 
        t.description?.toLowerCase().includes(search)
      );
    }
    return tasks;
  }, [tasksData, filters.search]);

  const handleRowClick = (task: Task) => {
    setSelectedTask(task);
    setIsPanelOpen(true);
  };

  const handleDeleteTask = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTask(taskId);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Tasks</h1>
        <p className="text-slate-500 mt-1">Track and manage QA findings across all projects</p>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search tasks by title or description..." 
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-md pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-accent transition-all"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select 
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as TaskStatus })}
            className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>

          <select 
            value={filters.severity}
            onChange={(e) => setFilters({ ...filters, severity: e.target.value as TaskSeverity })}
            className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select 
            value={filters.assignedTo}
            onChange={(e) => setFilters({ ...filters, assignedTo: e.target.value })}
            disabled={isDeveloper}
            className={`bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all ${isDeveloper ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <option value="">All Assignees</option>
            {/* Mocking unique assignees from tasks for now since no global user list is available */}
            {Array.from(new Set(tasksData?.data?.map(t => t.assigned_to).filter(Boolean))).map(id => {
              const task = tasksData?.data?.find(t => t.assigned_to === id);
              return <option key={id} value={id!}>{task?.users?.full_name || 'Unknown'}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Task Table */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Severity</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Task Title</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Assigned To</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Created</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={7} className="px-6 py-8 bg-slate-50/20"></td>
                </tr>
              ))
            ) : filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-20 text-center">
                  <div className="flex flex-col items-center justify-center space-y-4 opacity-40">
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-slate-300" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">No tasks found</h3>
                      <p className="text-sm text-slate-500">Try adjusting your filters or search query</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => (
                <tr 
                  key={task.id} 
                  onClick={() => handleRowClick(task)}
                  className="group hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${getSeverityStyles(task.severity)}`}>
                      {task.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-slate-900 group-hover:text-accent transition-colors">{task.title}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <Layers className="w-3 h-3 text-slate-400" />
                      <span className="text-xs font-medium text-slate-600">{task.projects?.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 border border-slate-200">
                        {task.users?.full_name ? task.users.full_name.charAt(0) : <User className="w-3 h-3" />}
                      </div>
                      <span className="text-xs font-medium text-slate-600">{task.users?.full_name || 'Unassigned'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${getStatusStyles(task.status)}`}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2 text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span className="text-xs font-medium">{format(new Date(task.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      {isQaEngineer && (
                        <button
                          onClick={(e) => handleDeleteTask(e, task.id)}
                          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                          title="Delete task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-accent transform group-hover:translate-x-1 transition-all" />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TaskDetailPanel 
        task={selectedTask}
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
      />
    </div>
  );
};
