import { z } from 'zod';
import { runClaude } from './claude-ai.js';
import {
  getRequirementInput,
  createAITaskSuggestion,
} from '../db/queries/tasks.js';
import { getProjectMembers } from '../db/queries/projects.js';
import { getUserById } from '../db/queries/users.js';
import { getUserProfile } from '../db/queries/ai.js';

const TaskSuggestionSchema = z.array(z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  effort: z.enum(['xs', 's', 'm', 'l', 'xl']),
  suggestedAssigneeId: z.number().nullable().optional(),
}));

type TaskSuggestion = z.infer<typeof TaskSuggestionSchema>;

/**
 * Generate task suggestions from a requirement input using AI.
 */
export async function generateTaskSuggestions(requirementInputId: number): Promise<void> {
  const input = await getRequirementInput(requirementInputId);
  if (!input || !input.content) {
    throw new Error('Requirement input not found or empty');
  }

  // Get project members for assignee suggestions
  const members = await getProjectMembers(input.projectId);
  const memberProfiles = await Promise.all(
    members.map(async (m: any) => {
      const user = await getUserById(m.userId);
      const profile = await getUserProfile(m.userId);
      return {
        id: m.userId,
        name: user?.name || 'Unknown',
        skills: profile?.profile ? extractSkills(profile.profile) : [],
      };
    })
  );

  const prompt = buildTaskGenerationPrompt(input.content, input.inputType, memberProfiles);

  try {
    const { data: suggestedTasks } = await runClaude({
      prompt,
      systemPrompt: 'You are a JSON API. You analyze requirements and generate structured tasks. Respond with ONLY valid JSON, no markdown formatting, no explanation text. Just the raw JSON array.',
      schema: TaskSuggestionSchema,
      timeout: 60000,
    });

    await createAITaskSuggestion({
      requirementInputId,
      projectId: input.projectId,
      suggestedTasks,
    });

    console.log(`[task-generation] Generated ${suggestedTasks.length} task suggestions for requirement ${requirementInputId}`);
  } catch (err) {
    console.error(`[task-generation] Failed to generate tasks for requirement ${requirementInputId}:`, err);
    throw err;
  }
}

function buildTaskGenerationPrompt(
  content: string,
  inputType: string,
  members: Array<{ id: number; name: string; skills: string[] }>
): string {
  const memberList = members.map(m =>
    `- ${m.name} (ID: ${m.id})${m.skills.length > 0 ? ` — skills: ${m.skills.join(', ')}` : ''}`
  ).join('\n');

  return `You are a project manager. Analyze the following ${inputType === 'document' ? 'document' : 'meeting notes/requirements'} and generate structured tasks.

## Input
${content}

## Team Members
${memberList || '(No members assigned yet)'}

## Instructions
Generate a JSON array of task objects. Each task should have:
- title: clear, actionable task title
- description: detailed description of what needs to be done
- priority: "low", "medium", "high", or "urgent"
- effort: "xs" (< 1 hour), "s" (1-4 hours), "m" (1-2 days), "l" (3-5 days), "xl" (1+ week)
- suggestedAssigneeId: team member ID who would be best suited (based on their skills), or null if unsure

Return ONLY a JSON array, no other text. Example:
[
  {
    "title": "Implement user authentication",
    "description": "Set up JWT-based auth with login/register endpoints...",
    "priority": "high",
    "effort": "m",
    "suggestedAssigneeId": 1
  }
]`;
}

function extractSkills(profileText: string): string[] {
  // Simple extraction from AI profile text
  const skills: string[] = [];
  const lower = profileText.toLowerCase();

  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'php', 'ruby', 'swift', 'kotlin', 'c#', 'react', 'vue', 'angular', 'node.js', 'express', 'fastify', 'django', 'laravel', 'spring'];
  for (const lang of languages) {
    if (lower.includes(lang)) skills.push(lang);
  }

  const domains = ['frontend', 'backend', 'devops', 'database', 'api', 'mobile', 'testing', 'security', 'infrastructure'];
  for (const domain of domains) {
    if (lower.includes(domain)) skills.push(domain);
  }

  return skills.slice(0, 8); // Limit to 8 top skills
}

// ---------------------------------------------------------------------------
// Task inference from cwd + prompt content (Phase 2, Item 12)
// ---------------------------------------------------------------------------

/**
 * Infer which task a developer is working on based on their cwd and recent prompt.
 */
export async function inferActiveTask(userId: number, cwd: string, _promptContent?: string): Promise<number | null> {
  // 1. Check if cwd matches a known project directory
  const { getProjectDirectories } = await import('../db/queries/tracking.js');
  const dirs = await getProjectDirectories(userId);

  let projectId: number | null = null;
  for (const dir of dirs) {
    if (cwd.startsWith(dir.localPath)) {
      projectId = dir.projectId;
      break;
    }
  }

  if (!projectId) return null;

  // 2. Get open tasks for this project assigned to this user
  const { getTasksByProject } = await import('../db/queries/tasks.js');
  const tasks = await getTasksByProject(projectId, { assigneeId: userId, status: 'in_progress' });

  if (tasks.length === 1) return tasks[0].id; // Only one active task — must be this one
  if (tasks.length === 0) return null;

  // 3. If multiple tasks, try to match by branch name or prompt content
  // (Simple keyword matching for now — AI inference can be added later)
  return tasks[0].id; // Default to first in-progress task
}

export { buildTaskGenerationPrompt };
