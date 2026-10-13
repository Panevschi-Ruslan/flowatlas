/** What the route modules of this fixture hand their work to. */
export interface Project {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
}

export const listProjects = async (): Promise<Project[]> => [];

export const oneProject = async (id: string): Promise<Project> => ({ id, name: '' });

export const createProject = async (name: string): Promise<Project> => ({ id: 'new', name });

export const oneTask = async (projectId: string, taskId: string): Promise<Task> => ({ id: taskId, title: projectId });

export const removeTask = async (taskId: string): Promise<void> => {
  void taskId;
};
